import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';

const DAILY_RECOMMENDATION_LIMIT = 5;
const ADMIN_DAILY_RECOMMENDATION_LIMIT = 100;

export type RecommendationQuota = {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
};

@Injectable()
export class RecommendationQuotaService {
  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async getQuotaForUser(
    userId: number,
    role?: Role | string | null,
  ): Promise<RecommendationQuota> {
    const { key, ttl, dayStart, resetAt } = this.quotaWindow(userId);
    const limit = this.limitForRole(role);
    const usage = await this.prisma.recommendationQuotaUsage.findUnique({
      where: { userId_day: { userId, day: dayStart } },
      select: { used: true },
    });
    const used = usage?.used ?? 0;
    await this.redisService.set(key, used, ttl);
    return this.quotaFromUsage(used, resetAt, limit);
  }

  async ensureAvailable(
    userId: number,
    role?: Role | string | null,
  ): Promise<void> {
    const quota = await this.getQuotaForUser(userId, role);
    if (quota.remaining <= 0) {
      throw this.quotaExceeded();
    }
  }

  async reserve(
    userId: number,
    role?: Role | string | null,
  ): Promise<RecommendationQuota> {
    return this.consume(userId, role);
  }

  async consume(
    userId: number,
    role?: Role | string | null,
  ): Promise<RecommendationQuota> {
    const { key, ttl, dayStart, resetAt } = this.quotaWindow(userId);
    const limit = this.limitForRole(role);
    const usage = await this.prisma.$transaction(async (tx) => {
      const nextUsage = await tx.recommendationQuotaUsage.upsert({
        where: { userId_day: { userId, day: dayStart } },
        create: { userId, day: dayStart, used: 1 },
        update: { used: { increment: 1 } },
        select: { used: true },
      });

      if (nextUsage.used > limit) {
        await tx.recommendationQuotaUsage.update({
          where: { userId_day: { userId, day: dayStart } },
          data: { used: { decrement: 1 } },
        });
      }

      return nextUsage;
    });

    const normalizedUsed = Math.max(0, usage.used);
    if (normalizedUsed > limit) {
      throw this.quotaExceeded();
    }

    await this.redisService.set(key, normalizedUsed, ttl);
    return this.quotaFromUsage(normalizedUsed, resetAt, limit);
  }

  async refund(
    userId: number,
    role?: Role | string | null,
  ): Promise<RecommendationQuota> {
    const { key, ttl, dayStart, resetAt } = this.quotaWindow(userId);
    const limit = this.limitForRole(role);
    const usage = await this.prisma.$transaction(async (tx) => {
      const current = await tx.recommendationQuotaUsage.findUnique({
        where: { userId_day: { userId, day: dayStart } },
        select: { used: true },
      });

      if (!current || current.used <= 0) {
        return { used: 0 };
      }

      return tx.recommendationQuotaUsage.update({
        where: { userId_day: { userId, day: dayStart } },
        data: { used: { decrement: 1 } },
        select: { used: true },
      });
    });

    const normalizedUsed = Math.max(0, usage.used);
    await this.redisService.set(key, normalizedUsed, ttl);
    return this.quotaFromUsage(normalizedUsed, resetAt, limit);
  }

  private quotaExceeded() {
    return new HttpException(
      'Daily AI recommendation limit reached',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private quotaFromUsage(
    used: number,
    resetAt: Date,
    limit: number,
  ): RecommendationQuota {
    const normalizedUsed = Math.min(limit, Math.max(0, used));
    return {
      limit,
      used: normalizedUsed,
      remaining: Math.max(0, limit - normalizedUsed),
      resetAt: resetAt.toISOString(),
    };
  }

  private limitForRole(role?: Role | string | null) {
    return role === Role.ADMIN
      ? ADMIN_DAILY_RECOMMENDATION_LIMIT
      : DAILY_RECOMMENDATION_LIMIT;
  }

  private quotaWindow(userId: number) {
    const now = new Date();
    const resetAt = new Date(now);
    resetAt.setUTCHours(24, 0, 0, 0);
    const day = now.toISOString().slice(0, 10);
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    return {
      key: `ai:recommendations:quota:${userId}:${day}`,
      ttl: Math.max(60_000, resetAt.getTime() - now.getTime()),
      dayStart,
      resetAt,
    };
  }
}
