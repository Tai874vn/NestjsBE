import { ConfigService } from '@nestjs/config';
import { once } from 'node:events';
import { AddressInfo, createServer, Server, Socket } from 'node:net';
import { AuthRedisService } from './auth-redis.service';

// A loopback RESP peer exercises the installed client, not a mocked Redis API.
function readCommand(
  buffer: Buffer,
): { args: string[]; bytes: number } | undefined {
  const firstLine = buffer.indexOf('\r\n');
  if (firstLine < 0) return undefined;
  const count = Number(buffer.subarray(1, firstLine).toString());
  let offset = firstLine + 2;
  const args: string[] = [];
  for (let i = 0; i < count; i++) {
    const end = buffer.indexOf('\r\n', offset);
    if (end < 0) return undefined;
    const length = Number(buffer.subarray(offset + 1, end).toString());
    if (buffer.length < end + 2 + length + 2) return undefined;
    args.push(buffer.subarray(end + 2, end + 2 + length).toString());
    offset = end + 2 + length + 2;
  }
  return { args, bytes: offset };
}

function bulk(value: string): string {
  return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
}

describe('AuthRedisService with the real Redis 5 client', () => {
  let server: Server;
  let sockets: Set<Socket>;
  let services: AuthRedisService[];
  let port: number;
  let respond: (socket: Socket, args: string[]) => void;
  let commands: string[][];
  let subscribers: Set<Socket>;

  function service(settings: Record<string, string | number> = {}) {
    const values = {
      AUTH_REDIS_URL: `redis://127.0.0.1:${port}`,
      AUTH_REDIS_PASSWORD: 'synthetic-wire-password',
      ...settings,
    };
    const instance = new AuthRedisService({
      get: (key: string) => values[key],
    } as ConfigService);
    services.push(instance);
    return instance;
  }

  beforeEach(async () => {
    sockets = new Set();
    subscribers = new Set();
    commands = [];
    services = [];
    respond = (socket, args) => {
      const command = args[0].toUpperCase();
      if (command === 'SUBSCRIBE') {
        subscribers.add(socket);
        socket.write(`*3\r\n${bulk('subscribe')}${bulk(args[1])}:1\r\n`);
      } else if (command === 'PUBLISH') {
        for (const subscriber of subscribers) {
          subscriber.write(
            `*3\r\n${bulk('message')}${bulk(args[1])}${bulk(args[2])}`,
          );
        }
        socket.write(`:${subscribers.size}\r\n`);
      } else if (command === 'GET') {
        socket.write('$-1\r\n');
      } else {
        socket.write('+OK\r\n');
      }
    };
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => {
        sockets.delete(socket);
        subscribers.delete(socket);
      });
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        let parsed: ReturnType<typeof readCommand>;
        while ((parsed = readCommand(buffer))) {
          buffer = buffer.subarray(parsed.bytes);
          commands.push(parsed.args);
          respond(socket, parsed.args);
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const instance of services) instance.onModuleDestroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('authenticates on both dedicated connections and receives a cache miss', async () => {
    const instance = service();
    await instance.onModuleInit();
    await expect(instance.readSession('sid')).resolves.toBeNull();
    expect(commands.filter(([command]) => command === 'AUTH')).toEqual([
      ['AUTH', 'synthetic-wire-password'],
      ['AUTH', 'synthetic-wire-password'],
    ]);
  });

  it('bounds startup when TCP connects but the Redis handshake never answers', async () => {
    respond = () => undefined;
    const instance = service({ AUTH_REDIS_CONNECT_TIMEOUT_MS: 100 });
    const start = Date.now();
    await expect(instance.onModuleInit()).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(1000);
    await expect(instance.readSession('sid')).resolves.toBeUndefined();
  });

  it('honors an explicit auth password instead of stale URL credentials', async () => {
    const instance = service({
      AUTH_REDIS_URL: `redis://test-user:synthetic-old-password@127.0.0.1:${port}`,
    });
    await instance.onModuleInit();
    expect(commands.filter(([command]) => command === 'AUTH')).toEqual([
      ['AUTH', 'test-user', 'synthetic-wire-password'],
      ['AUTH', 'test-user', 'synthetic-wire-password'],
    ]);
  });

  it('does not stall boot or the primary connection on an unacknowledged subscription', async () => {
    const normal = respond;
    respond = (socket, args) => {
      if (args[0].toUpperCase() !== 'SUBSCRIBE') normal(socket, args);
    };
    const instance = service({ AUTH_REDIS_COMMAND_TIMEOUT_MS: 50 });
    await expect(instance.onModuleInit()).resolves.toBeUndefined();
    await expect(instance.readSession('sid')).resolves.toBeNull();
  });

  it('destroys stalled command sockets and does not queue requests during the breaker', async () => {
    const normal = respond;
    respond = (socket, args) => {
      if (args[0] !== 'GET') normal(socket, args);
    };
    const instance = service({ AUTH_REDIS_COMMAND_TIMEOUT_MS: 50 });
    await instance.onModuleInit();
    await expect(instance.readSession('sid')).resolves.toBeUndefined();
    await expect(instance.readSession('sid-again')).resolves.toBeUndefined();
    expect(commands.filter(([command]) => command === 'GET')).toEqual([
      ['GET', 'auth:session:sid'],
    ]);
  });

  it('delivers revocations between instances through actual client Pub/Sub', async () => {
    const first = service();
    const second = service();
    await first.onModuleInit();
    await second.onModuleInit();
    let deliver!: (sid: string) => void;
    const received = new Promise<string>((resolve) => {
      deliver = resolve;
    });
    const remove = second.onRevocation(deliver);
    await expect(first.publishRevocation('sid')).resolves.toBe(true);
    await expect(received).resolves.toBe('sid');
    remove();
  });

  it('cancels in-flight deadlines immediately on shutdown', async () => {
    const normal = respond;
    respond = (socket, args) => {
      if (args[0] !== 'GET') normal(socket, args);
    };
    const instance = service({ AUTH_REDIS_COMMAND_TIMEOUT_MS: 2000 });
    await instance.onModuleInit();
    const reading = instance.readSession('sid');
    await new Promise<void>((resolve) => setImmediate(resolve));
    instance.onModuleDestroy();
    await expect(reading).resolves.toBeUndefined();
  });
});
