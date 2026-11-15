import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import {
  REDIS_CLIENT_OPTIONS,
  watchRedisErrors,
} from '../../common/redis/redis-client-errors';
import { RedisService } from './redis.service';
import { RedisController } from './redis.controller';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisModule');

@Injectable()
class RedisClientLifecycleService implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: ReturnType<typeof createClient> | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }
}

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');

        if (redisUrl) {
          try {
            const client = createClient({
              url: redisUrl,
              ...REDIS_CLIENT_OPTIONS,
            });
            watchRedisErrors(client, logger, 'cache');
            await client.connect();
            logger.log('Connected to Redis successfully');

            return {
              store: {
                get: async (key: string) => {
                  const value = await client.get(key);
                  return value ? JSON.parse(value) : undefined;
                },
                set: async (key: string, value: unknown, ttl?: number) => {
                  const stringValue = JSON.stringify(value);
                  if (ttl) {
                    await client.setEx(
                      key,
                      Math.floor(ttl / 1000),
                      stringValue,
                    );
                  } else {
                    await client.set(key, stringValue);
                  }
                },
                del: async (key: string) => {
                  await client.del(key);
                },
                scan: async (pattern = '*') => {
                  const keys: string[] = [];
                  for await (const entry of client.scanIterator({
                    MATCH: pattern,
                    COUNT: 100,
                  })) {
                    if (Array.isArray(entry)) keys.push(...entry);
                    else keys.push(entry);
                  }
                  return keys;
                },
                unlink: async (keys: string[]) => {
                  for (let index = 0; index < keys.length; index += 100) {
                    const batch = keys.slice(index, index + 100);
                    if (batch.length) await client.unlink(batch);
                  }
                },
                mget: async (...keys: string[]) => {
                  const values = await client.mGet(keys);
                  return values.map((v) => (v ? JSON.parse(v) : undefined));
                },
                mset: async (entries: [string, unknown][], ttl?: number) => {
                  for (const [key, value] of entries) {
                    const stringValue = JSON.stringify(value);
                    if (ttl) {
                      await client.setEx(
                        key,
                        Math.floor(ttl / 1000),
                        stringValue,
                      );
                    } else {
                      await client.set(key, stringValue);
                    }
                  }
                },
                mdel: async (...keys: string[]) => {
                  if (keys.length > 0) {
                    await client.del(keys);
                  }
                },
                ttl: async (key: string) => {
                  return client.ttl(key);
                },
                client,
              },
              ttl: 5 * 60 * 1000, // Default 5 minutes
            };
          } catch (error) {
            logger.warn(
              `Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}. Falling back to in-memory cache.`,
            );
          }
        } else {
          logger.log('REDIS_URL not configured. Using in-memory cache.');
        }

        // Fallback to in-memory cache
        return {
          ttl: 5 * 60 * 1000,
        };
      },
    }),
  ],
  controllers: [RedisController],
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (!redisUrl) return null;

        try {
          const client = createClient({
            url: redisUrl,
            ...REDIS_CLIENT_OPTIONS,
          });
          watchRedisErrors(client, logger, 'shared');
          await client.connect();
          logger.log('Redis client created for Socket.io adapter');
          return client;
        } catch (error) {
          logger.warn(
            `Failed to create Redis client for Socket.io: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          return null;
        }
      },
    },
    RedisClientLifecycleService,
  ],
  exports: [CacheModule, RedisService, REDIS_CLIENT],
})
export class RedisModule {}
