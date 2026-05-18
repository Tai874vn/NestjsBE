import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

// Define cache interface for compatibility
interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  reset?(): Promise<void>;
  keys?(pattern: string): Promise<string[]>;
  store?: {
    keys?: (pattern: string) => Promise<string[]>;
    client?: { keys: (pattern: string) => Promise<string[]> };
    reset?: () => Promise<void>;
  };
}

// Cache key prefixes for different entities
export const CACHE_KEYS = {
  JOB_MENU: 'job:menu',
  JOB_DETAIL: 'job:detail:',
  JOB_LIST: 'job:list:',
  JOB_BY_CATEGORY: 'job:category:',
  JOB_SEARCH: 'job:search:',
  USER: 'user:',
  USER_LIST: 'user:list',
  CATEGORY: 'category:',
  CATEGORY_LIST: 'category:list',
  CATEGORY_DETAIL: 'category:detail:',
  SKILL_LIST: 'skill:list',
  COMMENT_BY_JOB: 'comment:job:',
} as const;

// TTL values in milliseconds
export const CACHE_TTL = {
  SHORT: 2 * 60 * 1000, // 2 minutes - for frequently changing data
  MEDIUM: 10 * 60 * 1000, // 10 minutes - for moderately stable data
  LONG: 60 * 60 * 1000, // 1 hour - for stable data
  VERY_LONG: 24 * 60 * 60 * 1000, // 24 hours - for rarely changing data
} as const;

@Injectable()
export class RedisService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: CacheStore) {}

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
  }

  /**
   * Delete a specific key from cache
   */
  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  /**
   * Delete multiple keys matching a pattern
   * Note: This requires the Redis store to support keys() method
   */
  async delByPattern(pattern: string): Promise<void> {
    let keys: string[] = [];

    // Try different ways to get keys based on cache manager implementation
    if (this.cacheManager.keys) {
      keys = await this.cacheManager.keys(pattern);
    } else if (this.cacheManager.store?.keys) {
      keys = await this.cacheManager.store.keys(pattern);
    } else if (this.cacheManager.store?.client?.keys) {
      keys = await this.cacheManager.store.client.keys(pattern);
    }

    for (const key of keys) {
      await this.cacheManager.del(key);
    }
  }

  /**
   * Get or set pattern - tries to get from cache, if not found, executes factory and caches result
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Invalidate job-related caches
   */
  async invalidateJobCaches(jobId?: number): Promise<void> {
    // Always invalidate menu and list caches
    await this.del(CACHE_KEYS.JOB_MENU);
    await this.delByPattern(`${CACHE_KEYS.JOB_LIST}*`);
    await this.delByPattern(`${CACHE_KEYS.JOB_SEARCH}*`);
    await this.delByPattern(`${CACHE_KEYS.JOB_BY_CATEGORY}*`);

    // If specific job ID, invalidate that job's detail cache
    if (jobId) {
      await this.del(`${CACHE_KEYS.JOB_DETAIL}${jobId}`);
    }
  }

  /**
   * Invalidate user-related caches
   */
  async invalidateUserCaches(userId?: number): Promise<void> {
    await this.del(CACHE_KEYS.USER_LIST);
    await this.del(CACHE_KEYS.SKILL_LIST);

    if (userId) {
      await this.del(`${CACHE_KEYS.USER}${userId}`);
      await this.del(`${CACHE_KEYS.USER}profile:${userId}`);
    }
  }

  /**
   * Invalidate category-related caches
   */
  async invalidateCategoryCaches(categoryId?: number): Promise<void> {
    await this.del(CACHE_KEYS.CATEGORY_LIST);
    await this.del(CACHE_KEYS.JOB_MENU);

    if (categoryId) {
      await this.del(`${CACHE_KEYS.CATEGORY}${categoryId}`);
      await this.del(`${CACHE_KEYS.CATEGORY_DETAIL}${categoryId}`);
    }
  }

  /**
   * Invalidate comment caches for a job
   */
  async invalidateCommentCaches(jobId: number): Promise<void> {
    await this.del(`${CACHE_KEYS.COMMENT_BY_JOB}${jobId}`);
    // Also invalidate the job detail since it includes comments
    await this.del(`${CACHE_KEYS.JOB_DETAIL}${jobId}`);
  }

  /**
   * Reset all caches
   */
  async reset(): Promise<void> {
    if (this.cacheManager.reset) {
      await this.cacheManager.reset();
    } else if (this.cacheManager.store?.reset) {
      await this.cacheManager.store.reset();
    }
  }
}
