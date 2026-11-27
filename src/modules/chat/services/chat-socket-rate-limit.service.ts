/**
 * WebSocket rate limit service for the chat module.
 * It enforces per-user, per-event limits in Redis and falls back to in-memory counters if Redis is unavailable.
 *
 * Calls: Redis (REDIS_CLIENT)
 * Used by:
 *   - src/modules/chat/chat.module.ts
 *   - src/modules/chat/gateways/chat.gateway.ts
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createClient } from 'redis';
import { REDIS_CLIENT } from '../../redis/redis.module';

export type SocketRateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class ChatSocketRateLimitService {
  private readonly logger = new Logger(ChatSocketRateLimitService.name);
  private readonly buckets = new Map<string, Bucket>();
  private readonly redisClient: ReturnType<typeof createClient> | null;

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    injectedRedisClient: ReturnType<typeof createClient> | null,
  ) {
    this.redisClient = injectedRedisClient;
  }

  async consume(
    userId: number,
    event: string,
    limit: number,
    windowMs: number,
  ): Promise<SocketRateLimitResult> {
    if (this.redisClient) {
      try {
        return await this.consumeRedis(userId, event, limit, windowMs);
      } catch (error) {
        this.logger.warn(
          `Redis socket rate limit failed, using in-memory fallback: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return this.consumeMemory(userId, event, limit, windowMs);
  }

  private async consumeRedis(
    userId: number,
    event: string,
    limit: number,
    windowMs: number,
  ): Promise<SocketRateLimitResult> {
    const key = `chat:socket-rate:${userId}:${event}`;
    const count = await this.redisClient!.incr(key);
    if (count === 1) {
      await this.redisClient!.pExpire(key, windowMs);
    }

    if (count <= limit) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const ttl = await this.redisClient!.pTTL(key);
    return { allowed: false, retryAfterMs: Math.max(0, ttl) };
  }

  private consumeMemory(
    userId: number,
    event: string,
    limit: number,
    windowMs: number,
  ): SocketRateLimitResult {
    const now = Date.now();
    const key = `${userId}:${event}`;
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return { allowed: true, retryAfterMs: 0 };
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, bucket.resetAt - now),
      };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number) {
    if (this.buckets.size < 1000) return;

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
