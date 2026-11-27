/**
 * Recommendations module service that stores recommendation results and per-scope run locks in Redis.
 * It caches job matches, candidate matches, and hiring-post candidate matches for 5 minutes.
 *
 * Calls: RedisService
 * Used by:
 *   - src/modules/recommendations/recommendations.module.ts
 *   - src/modules/recommendations/services/recommendation-snapshot.service.ts
 *   - src/modules/recommendations/services/recommendations.service.ts
 */

import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/services/redis.service';

export const RECOMMENDATION_CACHE_TTL_MS = 5 * 60 * 1000;
const RECOMMENDATION_RUN_LOCK_TTL_MS = 5 * 60 * 1000;

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

  acquireRunLock(scope: string): Promise<string | undefined> {
    return this.redisService.acquireLock(
      `ai:recommendations:run:${scope}`,
      RECOMMENDATION_RUN_LOCK_TTL_MS,
    );
  }

  releaseRunLock(scope: string, token: string): Promise<void> {
    return this.redisService.releaseLock(
      `ai:recommendations:run:${scope}`,
      token,
    );
  }

  getJobs<T>(
    userId: number,
    topK: number,
    poolSize: number,
    fingerprint: string,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    return this.redisService.get<CachedRecommendationResult<T>>(
      this.jobsKey(userId, topK, poolSize, fingerprint),
    );
  }

  setJobs<T>(
    userId: number,
    topK: number,
    poolSize: number,
    fingerprint: string,
    value: CachedRecommendationResult<T>,
  ): Promise<void> {
    return this.redisService.set(
      this.jobsKey(userId, topK, poolSize, fingerprint),
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

  getHiringPostCandidates<T>(
    userId: number,
    hiringPostId: number,
    topK: number,
    poolSize: number,
    fingerprint: string,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    return this.redisService.get<CachedRecommendationResult<T>>(
      this.hiringPostCandidatesKey(
        userId,
        hiringPostId,
        topK,
        poolSize,
        fingerprint,
      ),
    );
  }

  setHiringPostCandidates<T>(
    userId: number,
    hiringPostId: number,
    topK: number,
    poolSize: number,
    fingerprint: string,
    value: CachedRecommendationResult<T>,
  ): Promise<void> {
    return this.redisService.set(
      this.hiringPostCandidatesKey(
        userId,
        hiringPostId,
        topK,
        poolSize,
        fingerprint,
      ),
      value,
      RECOMMENDATION_CACHE_TTL_MS,
    );
  }

  private jobsKey(
    userId: number,
    topK: number,
    poolSize: number,
    fingerprint: string,
  ): string {
    return `ai:recommendations:jobs:${userId}:${topK}:${poolSize}:${fingerprint}`;
  }

  private candidatesKey(
    userId: number,
    jobId: number,
    topK: number,
    poolSize: number,
  ): string {
    return `ai:recommendations:candidates:${userId}:${jobId}:${topK}:${poolSize}`;
  }

  private hiringPostCandidatesKey(
    userId: number,
    hiringPostId: number,
    topK: number,
    poolSize: number,
    fingerprint: string,
  ): string {
    return `ai:recommendations:hiring-post-candidates:${userId}:${hiringPostId}:${topK}:${poolSize}:${fingerprint}`;
  }
}
