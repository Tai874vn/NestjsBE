import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { watchRedisErrors } from '../redis/redis-client-errors';
import { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private logger = new Logger('RedisIoAdapter');
  private pubClient: ReturnType<typeof createClient> | null = null;
  private subClient: ReturnType<typeof createClient> | null = null;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(redisUrl: string): Promise<void> {
    try {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      watchRedisErrors(pubClient, this.logger, 'socket.io pub');
      watchRedisErrors(subClient, this.logger, 'socket.io sub');

      await Promise.all([pubClient.connect(), subClient.connect()]);

      this.pubClient = pubClient;
      this.subClient = subClient;
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log(
        'Socket.io Redis adapter connected — cross-instance messaging enabled',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to connect Redis adapter: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to in-memory adapter.`,
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(
      [this.pubClient, this.subClient]
        .filter((client): client is ReturnType<typeof createClient> =>
          Boolean(client?.isOpen),
        )
        .map((client) => client.quit()),
    );
  }
}
