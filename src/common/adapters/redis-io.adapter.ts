import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { watchRedisErrors } from '../redis/redis-client-errors';
import { Server, ServerOptions } from 'socket.io';

/**
 * LETS SEVERAL BACKEND COPIES SHARE ONE REAL-TIME CHAT.
 *
 * Socket.IO keeps an open connection (a WebSocket: a two-way line that stays open, so the server can push
 * a message to the browser at any time, without the browser asking). Each browser is connected to ONE
 * backend copy. Problem: if user A is on backend 1 and user B is on backend 2, backend 1 cannot reach B.
 *
 * Solution: the Redis adapter uses Redis "pub/sub" (publish/subscribe: one side publishes a message on a
 * channel, everyone subscribed to that channel receives it). When backend 1 sends to a room, the message
 * also goes through Redis, and backend 2 delivers it to its own connected users in that room.
 * pubClient sends, subClient listens (Redis needs two separate connections for this).
 *
 * If Redis is not reachable, we fall back to the normal in-memory adapter: chat still works, but only
 * between users on the same backend copy. Set up in main.ts.
 */
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
