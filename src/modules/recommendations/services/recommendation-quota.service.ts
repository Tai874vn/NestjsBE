import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

const DAILY_RECOMMENDATION_LIMIT = 5;

export type RecommendationQuota = {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
};

@Injectable()
export class RecommendationQuotaService {
  constructor(private readonly redisService: RedisService) {}

  async getQuotaForUser(userId: number): Promise<RecommendationQuota> {
    const { key, resetAt } = this.quotaWindow(userId);
    const used = (await this.redisService.get<number>(key)) ?? 0;
    return this.quotaFromUsage(used, resetAt);
  }

  async ensureAvailable(userId: number): Promise<void> {
    const quota = await this.getQuotaForUser(userId);
    if (quota.remaining <= 0) {
      throw this.quotaExceeded();
    }
  }

  async consume(userId: number): Promise<RecommendationQuota> {
    const { key, ttl, resetAt } = this.quotaWindow(userId);
    const used = await this.redisService.increment(key, ttl);
    const normalizedUsed = Math.max(0, used);
    if (normalizedUsed > DAILY_RECOMMENDATION_LIMIT) {
      await this.redisService.decrement(key, ttl);
      throw this.quotaExceeded();
    }

    return this.quotaFromUsage(normalizedUsed, resetAt);
  }

  private quotaExceeded() {
    return new HttpException(
      'Daily AI recommendation limit reached',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private quotaFromUsage(used: number, resetAt: Date): RecommendationQuota {
    const normalizedUsed = Math.min(DAILY_RECOMMENDATION_LIMIT, Math.max(0, used));
    return {
      limit: DAILY_RECOMMENDATION_LIMIT,
      used: normalizedUsed,
      remaining: Math.max(0, DAILY_RECOMMENDATION_LIMIT - normalizedUsed),
      resetAt: resetAt.toISOString(),
    };
  }

  private quotaWindow(userId: number) {
    const now = new Date();
    const resetAt = new Date(now);
    resetAt.setUTCHours(24, 0, 0, 0);
    const day = now.toISOString().slice(0, 10);
    return {
      key: `ai:recommendations:quota:${userId}:${day}`,
      ttl: Math.max(60_000, resetAt.getTime() - now.getTime()),
      resetAt,
    };
  }
}
