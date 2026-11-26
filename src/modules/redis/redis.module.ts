import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import {
  REDIS_CLIENT_OPTIONS,
  watchRedisErrors,
} from '../../common/redis/redis-client-errors';
import { REDIS_CLIENT } from './utils/redis.constants';
import { RedisService } from './services/redis.service';
import { RedisController } from './controllers/redis.controller';

export { REDIS_CLIENT } from './utils/redis.constants';

const logger = new Logger('RedisModule');

@Injectable()
class RedisClientLifecycleService implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: ReturnType<typeof createClient> | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.client?.isOpen) return;
    try {
      await this.client.quit();
    } catch {
      // Ignore shutdown errors if Redis is already disconnected.
    }
  }
}

@Global()
@Module({
  controllers: [RedisController],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (!redisUrl) {
          logger.log('REDIS_URL not configured. Using in-memory cache.');
          return null;
        }

        const client = createClient({
          url: redisUrl,
          ...REDIS_CLIENT_OPTIONS,
        });
        watchRedisErrors(client, logger, 'cache');

        try {
          await client.connect();
          logger.log(
            'Connected to Redis successfully (shared cache, locks, and Socket.IO client)',
          );
          return client;
        } catch (error) {
          logger.warn(
            `Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to in-memory cache.`,
          );
          if (client.isOpen) {
            await client.quit().catch(() => undefined);
          } else {
            client.destroy();
          }
          return null;
        }
      },
    },
    RedisService,
    RedisClientLifecycleService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
