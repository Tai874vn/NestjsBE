/**
 * Common Socket.IO adapter that backs WebSocket rooms with Redis pub/sub for multi-instance real-time chat.
 * Falls back to the default in-memory adapter if Redis cannot be reached, and closes its Redis clients on shutdown.
 *
 * Calls: Redis; watchRedisErrors
 * Used by:
 *   - src/main.ts
 */

import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { watchRedisErrors } from '../../modules/redis/utils/redis-client-errors';
import { Server, ServerOptions } from 'socket.io';

type SharedRedisClient = ReturnType<typeof createClient>;

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
 * pubClient sends (reusing the shared REDIS_CLIENT when passed), subClient listens (Redis needs a
 * dedicated subscriber connection for pub/sub).
 *
 * If Redis is not reachable, we fall back to the normal in-memory adapter: chat still works, but only
 * between users on the same backend copy. Set up in main.ts.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private readonly adapterLogger = new Logger('RedisIoAdapter');
  private pubClient: SharedRedisClient | null = null;
  private subClient: SharedRedisClient | null = null;
  private ownsPubClient = false;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(source: string | SharedRedisClient): Promise<void> {
    let createdPubClient: SharedRedisClient | null = null;
    let createdSubClient: SharedRedisClient | null = null;

    try {
      const pubClient =
        typeof source === 'string' ? createClient({ url: source }) : source;
      const ownsPubClient = typeof source === 'string';
      if (ownsPubClient) {
        createdPubClient = pubClient;
        watchRedisErrors(pubClient, this.adapterLogger, 'socket.io pub');
      }

      const subClient = pubClient.duplicate();
      createdSubClient = subClient;
      watchRedisErrors(subClient, this.adapterLogger, 'socket.io sub');

      if (ownsPubClient) {
        await Promise.all([pubClient.connect(), subClient.connect()]);
      } else {
        await subClient.connect();
      }

      this.pubClient = pubClient;
      this.subClient = subClient;
      this.ownsPubClient = ownsPubClient;
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.adapterLogger.log(
        'Socket.io Redis adapter connected — cross-instance messaging enabled',
      );
    } catch (error) {
      await Promise.all(
        [createdSubClient, createdPubClient]
          .filter((client): client is SharedRedisClient => Boolean(client))
          .map((client) =>
            client.isOpen
              ? client.quit().catch(() => undefined)
              : Promise.resolve(client.destroy()),
          ),
      );
      this.adapterLogger.warn(
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
    const clientsToClose: Array<SharedRedisClient | null> = [
      this.subClient,
      this.ownsPubClient ? this.pubClient : null,
    ];
    await Promise.all(
      clientsToClose
        .filter((client): client is SharedRedisClient =>
          Boolean(client?.isOpen),
        )
        .map((client) => client.quit().catch(() => undefined)),
    );
  }
}
