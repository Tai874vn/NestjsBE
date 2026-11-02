import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRedisService } from './auth-redis.service';

@Module({
  imports: [ConfigModule],
  providers: [AuthRedisService, AuthRateLimitGuard],
  exports: [AuthRedisService, AuthRateLimitGuard],
})
export class AuthSessionRedisModule {}
