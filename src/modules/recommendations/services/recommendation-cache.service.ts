import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export const RECOMMENDATION_CACHE_TTL_MS = 5 * 60 * 1000;

export type CachedRecommendationResult<T> = {
  data: T[];
  model: string;
  elapsedMs: number;
  generatedAt: string;
};

@Injectable()
export class RecommendationCacheService {
  readonly ttlSeconds = Math.floor(RECOMMENDATION_CACHE_TTL_MS / 1000);

  constructor(private readonly redisService: RedisService) {}

  getJobs<T>(
    userId: number,
    topK: number,
    poolSize: number,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    return this.redisService.get<CachedRecommendationResult<T>>(
      this.jobsKey(userId, topK, poolSize),
    );
  }

  setJobs<T>(
    userId: number,
    topK: number,
    poolSize: number,
    value: CachedRecommendationResult<T>,
  ): Promise<void> {
    return this.redisService.set(
      this.jobsKey(userId, topK, poolSize),
      value,
      RECOMMENDATION_CACHE_TTL_MS,
    );
  }

  getCandidates<T>(
    userId: number,
    jobId: number,
    topK: number,
    poolSize: number,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    return this.redisService.get<CachedRecommendationResult<T>>(
      this.candidatesKey(userId, jobId, topK, poolSize),
    );
  }

  setCandidates<T>(
    userId: number,
    jobId: number,
    topK: number,
    poolSize: number,
    value: CachedRecommendationResult<T>,
  ): Promise<void> {
    return this.redisService.set(
      this.candidatesKey(userId, jobId, topK, poolSize),
      value,
      RECOMMENDATION_CACHE_TTL_MS,
    );
  }

  private jobsKey(userId: number, topK: number, poolSize: number): string {
    return `ai:recommendations:jobs:${userId}:${topK}:${poolSize}`;
  }

  private candidatesKey(
    userId: number,
    jobId: number,
    topK: number,
    poolSize: number,
  ): string {
    return `ai:recommendations:candidates:${userId}:${jobId}:${topK}:${poolSize}`;
  }
}
