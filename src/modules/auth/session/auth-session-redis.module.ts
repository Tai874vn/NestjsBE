/**
 * Sub-module for auth Redis session support. It imports ConfigModule and registers and exports AuthRedisService and AuthRateLimitGuard.
 *
 * Calls: AuthRedisService; AuthRateLimitGuard
 * Used by:
 *   - src/modules/auth/auth.module.ts
 */

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
