import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRedisService } from './auth-redis.service';
import { AuthSessionRedisModule } from './auth-session-redis.module';

describe('AuthSessionRedisModule', () => {
  it('exports the dedicated transport and guard without the general Redis module', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule, AuthSessionRedisModule],
      providers: [
        {
          provide: 'consumer',
          useFactory: (redis: AuthRedisService, guard: AuthRateLimitGuard) => ({
            redis,
            guard,
          }),
          inject: [AuthRedisService, AuthRateLimitGuard],
        },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: () => undefined })
      .compile();
    try {
      const consumer = module.get<{
        redis: AuthRedisService;
        guard: AuthRateLimitGuard;
      }>('consumer');
      expect(consumer.redis).toBeInstanceOf(AuthRedisService);
      expect(consumer.guard).toBeInstanceOf(AuthRateLimitGuard);
      expect(() => module.get('REDIS_CLIENT')).toThrow();
    } finally {
      await module.close();
    }
  });
});
