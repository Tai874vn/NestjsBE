import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createClient } from 'redis';
import { AuthRedisService, type AuthCachedRefresh } from '../auth-redis.service';

jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('node:fs', () => ({ readFileSync: jest.fn() }));

class RedisDouble extends EventEmitter {
  isReady = false;
  isOpen = false;
  connect = jest.fn(() => {
    this.isReady = this.isOpen = true;
    return Promise.resolve(this);
  });
  destroy = jest.fn(() => {
    this.isReady = this.isOpen = false;
    this.emit('end');
  });
  get = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);
  set = jest.fn().mockResolvedValue('OK');
  eval = jest.fn().mockResolvedValue(1);
  publish = jest.fn().mockResolvedValue(1);
  subscribe = jest.fn().mockResolvedValue(undefined);
}

describe('AuthRedisService', () => {
  let clients: RedisDouble[];
  let service: AuthRedisService;
  const now = new Date('2026-11-02T00:00:00Z');
  const expiry = new Date('2026-11-02T00:01:00Z');
  const refresh: AuthCachedRefresh = {
    id: 'refresh-id',
    sessionId: 'sid',
    familyId: 'family',
    userId: 42,
    tokenHash: 'a'.repeat(64),
    expiresAt: '2026-11-02T00:01:00.000Z',
    usedAt: null,
    revokedAt: null,
  };

  function makeService(values: Record<string, unknown> = {}) {
    const config = {
      AUTH_REDIS_URL: 'redis://auth-only.invalid:6379',
      ...values,
    };
    service = new AuthRedisService({
      get: (key: string) => config[key],
    } as ConfigService);
    return service;
  }

  beforeEach(() => {
    jest.useFakeTimers({ now });
    clients = [];
    jest
      .mocked(createClient)
      .mockReset()
      .mockImplementation(() => {
        const client = new RedisDouble();
        clients.push(client);
        return client as never;
      });
    jest.mocked(readFileSync).mockReset();
    makeService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('uses only the auth URL, bounded queues, no reconnect loop, and runtime handlers', async () => {
    await service.onModuleInit();
    expect(createClient).toHaveBeenCalledTimes(2);
    for (const [options] of jest.mocked(createClient).mock.calls) {
      expect(options).toMatchObject({
        url: 'redis://auth-only.invalid:6379',
        disableOfflineQueue: true,
        commandsQueueMaxLength: 128,
        socket: { connectTimeout: 1000, reconnectStrategy: false },
      });
    }
    for (const client of clients) expect(client.listenerCount('error')).toBe(1);
  });

  it('never falls back to general Redis configuration when auth URL is absent', async () => {
    makeService({
      AUTH_REDIS_URL: undefined,
      REDIS_URL: 'redis://general.invalid',
    });
    await service.onModuleInit();
    await expect(service.readSession('sid')).resolves.toBeUndefined();
    await expect(service.writeSession('sid', 42, expiry)).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('supports an optional auth password variable', async () => {
    makeService({ AUTH_REDIS_PASSWORD: 'synthetic-test-password' });
    await service.onModuleInit();
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'synthetic-test-password',
      }),
    );
  });

  it('prefers the password file and removes its terminal newline', async () => {
    jest.mocked(readFileSync).mockReturnValue('synthetic-file-password\r\n');
    makeService({
      AUTH_REDIS_PASSWORD: 'not-used',
      AUTH_REDIS_PASSWORD_FILE: '/synthetic/test/password',
    });
    await service.onModuleInit();
    expect(readFileSync).toHaveBeenCalledWith(
      '/synthetic/test/password',
      'utf8',
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        password: 'synthetic-file-password',
      }),
    );
  });

  it('degrades safely if the configured password file cannot be read', async () => {
    jest.mocked(readFileSync).mockImplementation(() => {
      throw new Error('unreadable');
    });
    makeService({ AUTH_REDIS_PASSWORD_FILE: '/synthetic/test/missing' });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    await expect(service.readSession('sid')).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('distinguishes a session cache miss from a valid cached tombstone', async () => {
    await service.onModuleInit();
    await expect(service.readSession('sid')).resolves.toBeNull();
    clients[0].get.mockResolvedValue('{"userId":42,"revoked":true}');
    await expect(service.readSession('sid')).resolves.toEqual({
      userId: 42,
      revoked: true,
    });
    expect(clients[0].get).toHaveBeenLastCalledWith('auth:session:sid');
  });

  it.each(['{', '{}', '{"userId":"42","revoked":false}', '{"userId":42}'])(
    'treats malformed cached session %s as a cache miss, never a fail-open outage',
    async (value) => {
      await service.onModuleInit();
      clients[0].get.mockResolvedValue(value);
      await expect(service.readSession('sid')).resolves.toBeNull();
    },
  );

  it('writes active state with an atomic tombstone check and positive absolute TTL', async () => {
    await service.onModuleInit();
    await expect(service.writeSession('sid', 42, expiry)).resolves.toBe(true);
    const [script, options] = clients[0].eval.mock.calls[0];
    expect(script).toContain('revoked');
    expect(script).toContain("redis.call('SET'");
    expect(script).toContain("'PX'");
    expect(options).toEqual({
      keys: ['auth:session:sid'],
      arguments: ['{"userId":42,"revoked":false}', '60000'],
    });
    clients[0].eval.mockResolvedValue(0);
    await expect(service.writeSession('sid', 42, expiry)).resolves.toBe(false);
  });

  it('atomically tombstones, blacklists live indexed JTIs with remaining TTLs, and deletes the index', async () => {
    await service.onModuleInit();
    await expect(service.revokeSession('sid', 42, expiry)).resolves.toBe(true);
    const [script, options] = clients[0].eval.mock.calls[0];
    expect(script).toContain("redis.call('ZRANGEBYSCORE'");
    expect(script).toContain("redis.call('DEL'");
    expect(script).toContain("'PX'");
    expect(options).toEqual({
      keys: ['auth:session:sid', 'auth:session:sid:access'],
      arguments: [
        '{"userId":42,"revoked":true}',
        '60000',
        String(now.getTime()),
        'auth:access:revoked:',
      ],
    });
  });

  it('registers access atomically, prunes expired entries, and protects revoked sessions', async () => {
    await service.onModuleInit();
    await expect(service.registerAccess('sid', 'jti', expiry)).resolves.toBe(
      true,
    );
    const [script, options] = clients[0].eval.mock.calls[0];
    expect(script).toContain("redis.call('ZREMRANGEBYSCORE'");
    expect(script).toContain("redis.call('ZADD'");
    expect(script).toContain("redis.call('ZREVRANGE'");
    expect(script).toContain("redis.call('PEXPIRE'");
    expect(script).toContain('revoked');
    expect(options).toEqual({
      keys: [
        'auth:session:sid',
        'auth:session:sid:access',
        'auth:access:revoked:jti',
      ],
      arguments: ['jti', String(expiry.getTime()), String(now.getTime())],
    });
  });

  it('distinguishes unrevoked, blacklisted, and unavailable access tokens', async () => {
    await service.onModuleInit();
    await expect(service.isAccessRevoked('jti')).resolves.toBe(false);
    clients[0].get.mockResolvedValue('1');
    await expect(service.isAccessRevoked('jti')).resolves.toBe(true);
    expect(clients[0].get).toHaveBeenLastCalledWith('auth:access:revoked:jti');
    clients[0].get.mockRejectedValue(new Error('offline'));
    await expect(service.isAccessRevoked('jti')).resolves.toBeUndefined();
  });

  it('round trips refresh cache values with their absolute expiry', async () => {
    await service.onModuleInit();
    await expect(service.readRefresh('refresh-id')).resolves.toBeNull();
    await expect(service.writeRefresh(refresh)).resolves.toBe(true);
    expect(clients[0].set).toHaveBeenCalledWith(
      'auth:refresh:refresh-id',
      JSON.stringify(refresh),
      { PX: 60000 },
    );
    clients[0].get.mockResolvedValue(JSON.stringify(refresh));
    await expect(service.readRefresh('refresh-id')).resolves.toEqual(refresh);
    expect(clients[0].get).toHaveBeenLastCalledWith('auth:refresh:refresh-id');
  });

  it.each(['{', '{}', '{"id":"refresh-id"}'])(
    'treats malformed refresh cache %s as a cache miss',
    async (value) => {
      await service.onModuleInit();
      clients[0].get.mockResolvedValue(value);
      await expect(service.readRefresh('refresh-id')).resolves.toBeNull();
    },
  );

  it('never creates keys for expired, invalid or nonpositive expirations', async () => {
    await service.onModuleInit();
    await expect(service.writeSession('sid', 42, now)).resolves.toBe(false);
    await expect(service.revokeSession('sid', 42, new Date(NaN))).resolves.toBe(
      false,
    );
    await expect(
      service.registerAccess('sid', 'jti', new Date(now.getTime() - 1)),
    ).resolves.toBe(false);
    await expect(
      service.writeRefresh({ ...refresh, expiresAt: 'invalid' }),
    ).resolves.toBe(false);
    await expect(
      service.takeRateLimit('signin:ip', 10, 0),
    ).resolves.toBeUndefined();
    expect(clients[0].set).not.toHaveBeenCalled();
    expect(clients[0].eval).not.toHaveBeenCalled();
  });

  it('uses one atomic rate script with a positive expiry and enforces its result', async () => {
    await service.onModuleInit();
    await expect(service.takeRateLimit('signin:ip', 10, 60000)).resolves.toBe(
      true,
    );
    const [script, options] = clients[0].eval.mock.calls[0];
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('PEXPIRE'");
    expect(options).toEqual({
      keys: ['auth:rate:signin:ip'],
      arguments: ['10', '60000'],
    });
    clients[0].eval.mockResolvedValue(0);
    await expect(service.takeRateLimit('signin:ip', 10, 60000)).resolves.toBe(
      false,
    );
  });

  it('bounds a stalled connect and opens a breaker without repeated connection attempts', async () => {
    jest.mocked(createClient).mockImplementation(() => {
      const client = new RedisDouble();
      client.connect.mockImplementation(() => new Promise(() => {}));
      clients.push(client);
      return client as never;
    });
    const initializing = service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(initializing).resolves.toBeUndefined();
    await expect(service.readSession('sid')).resolves.toBeUndefined();
    await expect(
      service.takeRateLimit('signin:ip', 10, 60000),
    ).resolves.toBeUndefined();
    expect(createClient).toHaveBeenCalledTimes(2);
    for (const client of clients)
      expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('bounds stalled commands, destroys the queue, and recovers with a single new connection', async () => {
    await service.onModuleInit();
    clients[0].get.mockImplementation(() => new Promise(() => {}));
    const reading = service.readSession('sid');
    await jest.advanceTimersByTimeAsync(200);
    await expect(reading).resolves.toBeUndefined();
    expect(clients[0].destroy).toHaveBeenCalledTimes(1);
    await expect(service.readSession('sid')).resolves.toBeUndefined();
    expect(createClient).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(
      Promise.all([service.readSession('sid'), service.readSession('sid')]),
    ).resolves.toEqual([null, null]);
    expect(createClient).toHaveBeenCalledTimes(3);
  });

  it('returns false or undefined for rejected commands without leaking failures', async () => {
    await service.onModuleInit();
    clients[0].eval.mockRejectedValue(new Error('offline'));
    await expect(service.writeSession('sid', 42, expiry)).resolves.toBe(false);
    await expect(service.revokeSession('sid', 42, expiry)).resolves.toBe(false);
    await expect(service.writeRefresh(refresh)).resolves.toBe(false);
    await expect(service.registerAccess('sid', 'jti', expiry)).resolves.toBe(
      false,
    );
    await expect(service.publishRevocation('sid')).resolves.toBe(false);
    await expect(service.readRefresh('refresh-id')).resolves.toBeUndefined();
    await expect(
      service.takeRateLimit('signin:ip', 10, 60000),
    ).resolves.toBeUndefined();
  });

  it('bounds subscribe acknowledgement independently from connection readiness', async () => {
    jest.mocked(createClient).mockImplementation(() => {
      const client = new RedisDouble();
      client.subscribe.mockImplementation(() => new Promise(() => {}));
      clients.push(client);
      return client as never;
    });
    const initializing = service.onModuleInit();
    await jest.advanceTimersByTimeAsync(200);
    await expect(initializing).resolves.toBeUndefined();
    expect(clients[1].destroy).toHaveBeenCalledTimes(1);
    await expect(service.readSession('sid')).resolves.toBeNull();
  });

  it('delivers local revocation even if publishing fails and isolates listener failures', async () => {
    await service.onModuleInit();
    const listener = jest.fn();
    service.onRevocation(() => {
      throw new Error('listener');
    });
    const remove = service.onRevocation(listener);
    clients[0].publish.mockRejectedValue(new Error('offline'));
    await expect(service.publishRevocation('sid')).resolves.toBe(false);
    expect(listener).toHaveBeenCalledWith('sid');
    remove();
    await service.publishRevocation('other');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('delivers Pub/Sub from another instance and unsubscribes callbacks safely', async () => {
    const second = makeService();
    const first = new AuthRedisService({
      get: (key: string) =>
        key === 'AUTH_REDIS_URL' ? 'redis://auth-only.invalid:6379' : undefined,
    } as ConfigService);
    try {
      await first.onModuleInit();
      await second.onModuleInit();
      const listener = jest.fn();
      second.onRevocation(listener);
      const [channel, receive] = clients[3].subscribe.mock.calls[0];
      clients[0].publish.mockImplementation(
        (publishedChannel: string, message: string) => {
          expect(publishedChannel).toBe(channel);
          receive(message);
          return Promise.resolve(1);
        },
      );
      await expect(first.publishRevocation('remote-sid')).resolves.toBe(true);
      expect(listener).toHaveBeenCalledWith('remote-sid');
    } finally {
      first.onModuleDestroy();
    }
  });

  it('handles runtime subscriber errors, retries once per cooldown, and cancels cleanup work', async () => {
    await service.onModuleInit();
    expect(() =>
      clients[1].emit('error', new Error('connection reset')),
    ).not.toThrow();
    await jest.advanceTimersByTimeAsync(1000);
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(clients[2].subscribe).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    const listener = jest.fn();
    service.onRevocation(listener);
    await expect(service.publishRevocation('sid')).resolves.toBe(false);
    expect(listener).not.toHaveBeenCalled();
    for (const client of clients)
      expect(() => client.emit('error', new Error('late'))).not.toThrow();
    await jest.advanceTimersByTimeAsync(10000);
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });
});
