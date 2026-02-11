import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private logger = new Logger('RedisIoAdapter');

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(redisUrl: string): Promise<void> {
    try {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log('Socket.io Redis adapter connected — cross-instance messaging enabled');
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
}
