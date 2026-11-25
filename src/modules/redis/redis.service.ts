import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from './redis.constants';

// Minimal node-redis client interface used by RedisService (easy to mock in tests).
export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { PX?: number; NX?: boolean },
  ): Promise<string | null>;
  del(keys: string | string[]): Promise<number>;
  unlink?(keys: string | string[]): Promise<number>;
  scanIterator(options: {
    MATCH: string;
    COUNT?: number;
  }): AsyncIterable<string | string[]>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  pExpire(key: string, ttlMs: number): Promise<unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  isOpen?: boolean;
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

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const LOCAL_CACHE_MAX_ENTRIES = 5_000;
const UNLINK_BATCH_SIZE = 100;

const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

type LocalCacheEntry = {
  value: unknown;
  expiresAt: number;
};

type LocalLockEntry = {
  token: string;
  expiresAt: number;
};

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly namespace = 'jobaura:cache:';
  private readonly localCache = new Map<string, LocalCacheEntry>();
  private readonly localLocks = new Map<string, LocalLockEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxLocalEntries: number;
  private redisErrorLogged = false;

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly client: RedisCacheClient | null = null,
    @Optional() maxLocalEntries = LOCAL_CACHE_MAX_ENTRIES,
  ) {
    this.maxLocalEntries = maxLocalEntries;
  }

  /**
   * Read a value from Redis, or from the bounded in-memory map when Redis is not configured.
   * Returns undefined on a miss or when Redis fails.
   */
  async get<T>(key: string): Promise<T | undefined> {
    const namespacedKey = this.key(key);

    if (this.client) {
      try {
        const raw = await this.client.get(namespacedKey);
        this.markRedisHealthy();
        if (raw === null) return undefined;
        return JSON.parse(raw) as T;
      } catch (error) {
        this.warnOnce('get', error);
        return undefined;
      }
    }

    return this.getLocal<T>(namespacedKey);
  }

  /**
   * Store a value with an optional TTL in milliseconds (defaults to 5 minutes).
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const namespacedKey = this.key(key);
    const ttlMs = this.resolveTtlMs(ttl);

    if (this.client) {
      try {
        await this.client.set(namespacedKey, JSON.stringify(value), {
          PX: ttlMs,
        });
        this.markRedisHealthy();
      } catch (error) {
        this.warnOnce('set', error);
      }
      return;
    }

    this.setLocal(namespacedKey, value, ttlMs);
  }

  /**
   * Delete one key from cache.
   */
  async del(key: string): Promise<void> {
    const namespacedKey = this.key(key);

    if (this.client) {
      try {
        await this.client.del(namespacedKey);
        this.markRedisHealthy();
      } catch (error) {
        this.warnOnce('del', error);
      }
      return;
    }

    this.localCache.delete(namespacedKey);
  }

  /**
   * Atomically increase a counter and apply a TTL on the first increment.
   */
  async increment(key: string, ttl?: number): Promise<number> {
    const namespacedKey = this.key(key);

    if (this.client) {
      try {
        const value = await this.client.incr(namespacedKey);
        if (value === 1 && ttl && ttl > 0) {
          await this.client.pExpire(
            namespacedKey,
            Math.max(1, Math.floor(ttl)),
          );
        }
        this.markRedisHealthy();
        return value;
      } catch (error) {
        this.warnOnce('increment', error);
        return 0;
      }
    }

    const current = this.getLocal<number>(namespacedKey) ?? 0;
    const next = current + 1;
    this.setLocal(namespacedKey, next, this.resolveTtlMs(ttl));
    return next;
  }

  /**
   * Atomically decrease a counter and refresh its TTL when provided.
   */
  async decrement(key: string, ttl?: number): Promise<number> {
    const namespacedKey = this.key(key);

    if (this.client) {
      try {
        const value = await this.client.decr(namespacedKey);
        if (ttl && ttl > 0) {
          await this.client.pExpire(
            namespacedKey,
            Math.max(1, Math.floor(ttl)),
          );
        }
        this.markRedisHealthy();
        return value;
      } catch (error) {
        this.warnOnce('decrement', error);
        return 0;
      }
    }

    const current = this.getLocal<number>(namespacedKey) ?? 0;
    const next = Math.max(0, current - 1);
    this.setLocal(namespacedKey, next, this.resolveTtlMs(ttl));
    return next;
  }

  /**
   * Delete every key matching a glob pattern (for example "job:list:*").
   * Uses SCAN + UNLINK on Redis and regex matching on the in-memory fallback.
   */
  async delByPattern(pattern: string): Promise<void> {
    const namespacedPattern = this.key(pattern);

    if (this.client) {
      try {
        const matchedKeys: string[] = [];
        for await (const entry of this.client.scanIterator({
          MATCH: namespacedPattern,
          COUNT: UNLINK_BATCH_SIZE,
        })) {
          if (Array.isArray(entry)) {
            matchedKeys.push(...entry);
          } else {
            matchedKeys.push(entry);
          }

          if (matchedKeys.length >= UNLINK_BATCH_SIZE) {
            await this.unlinkBatch(matchedKeys.splice(0, UNLINK_BATCH_SIZE));
          }
        }

        if (matchedKeys.length > 0) {
          await this.unlinkBatch(matchedKeys);
        }
        this.markRedisHealthy();
      } catch (error) {
        this.warnOnce('delByPattern', error);
      }
      return;
    }

    const matcher = this.patternToRegExp(namespacedPattern);
    for (const key of this.localCache.keys()) {
      if (matcher.test(key)) {
        this.localCache.delete(key);
      }
    }
  }

  /**
   * Take a short-lived lock (SET NX PX on Redis, or an in-process map fallback).
   */
  async acquireLock(key: string, ttlMs: number): Promise<string | undefined> {
    const namespacedKey = this.key(`lock:${key}`);
    const token = randomUUID();
    const safeTtlMs = Math.max(1, Math.floor(ttlMs));

    if (this.client) {
      try {
        const result = await this.client.set(namespacedKey, token, {
          NX: true,
          PX: safeTtlMs,
        });
        this.markRedisHealthy();
        return result === 'OK' ? token : undefined;
      } catch (error) {
        this.warnOnce('acquireLock', error);
        // Fall back to a local lock so callers do not fail with false conflicts while Redis is down.
        return this.acquireLocalLock(namespacedKey, token, safeTtlMs);
      }
    }

    return this.acquireLocalLock(namespacedKey, token, safeTtlMs);
  }

  /**
   * Release a lock only if the stored token matches our token.
   */
  async releaseLock(key: string, token: string): Promise<void> {
    const namespacedKey = this.key(`lock:${key}`);

    if (this.client) {
      try {
        await this.client.eval(RELEASE_LOCK_SCRIPT, {
          keys: [namespacedKey],
          arguments: [token],
        });
        this.markRedisHealthy();
      } catch (error) {
        this.warnOnce('releaseLock', error);
      }
    }

    if (this.localLocks.get(namespacedKey)?.token === token) {
      this.localLocks.delete(namespacedKey);
    }
  }

  /**
   * Read from cache, or run the factory once for concurrent misses (single-flight) and cache the result.
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

    const namespacedKey = this.key(key);
    const existing = this.inFlight.get(namespacedKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const pending = (async () => {
      const value = await factory();
      await this.set(key, value, ttl);
      return value;
    })();

    this.inFlight.set(namespacedKey, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(namespacedKey) === pending) {
        this.inFlight.delete(namespacedKey);
      }
    }
  }

  /**
   * Invalidate job-related caches, including category job counts.
   */
  async invalidateJobCaches(jobId?: number): Promise<void> {
    await this.del(CACHE_KEYS.JOB_MENU);
    await this.delByPattern(`${CACHE_KEYS.JOB_LIST}*`);
    await this.delByPattern(`${CACHE_KEYS.JOB_SEARCH}*`);
    await this.delByPattern(`${CACHE_KEYS.JOB_BY_CATEGORY}*`);
    await this.delByPattern(`${CACHE_KEYS.CATEGORY_DETAIL}*`);

    if (jobId) {
      await this.invalidateJobDetail(jobId);
    }
  }

  /**
   * Clear both detail keys of one job: "job:detail:<id>" (findOne) and "job:detail:full:<id>" (the details page).
   * Missing the second one kept a deleted or edited post on its page until the cache expired.
   */
  private async invalidateJobDetail(jobId: number): Promise<void> {
    await this.del(`${CACHE_KEYS.JOB_DETAIL}${jobId}`);
    await this.del(`${CACHE_KEYS.JOB_DETAIL}full:${jobId}`);
  }

  /**
   * Invalidate a user's public profile cache key ("user:profile:<id>").
   */
  async invalidateUserProfile(userId: number): Promise<void> {
    await this.del(`${CACHE_KEYS.USER}profile:${userId}`);
  }

  /**
   * Invalidate user-related public caches.
   */
  async invalidateUserCaches(userId?: number): Promise<void> {
    await this.del(CACHE_KEYS.SKILL_LIST);

    if (userId) {
      await this.invalidateUserProfile(userId);
    }
  }

  /**
   * Invalidate category caches and job listings that embed category/subcategory data.
   */
  async invalidateCategoryCaches(categoryId?: number): Promise<void> {
    await this.del(CACHE_KEYS.CATEGORY_LIST);
    await this.del(CACHE_KEYS.JOB_MENU);
    await this.delByPattern(`${CACHE_KEYS.JOB_LIST}*`);
    await this.delByPattern(`${CACHE_KEYS.JOB_BY_CATEGORY}*`);

    if (categoryId) {
      await this.del(`${CACHE_KEYS.CATEGORY}${categoryId}`);
      await this.del(`${CACHE_KEYS.CATEGORY_DETAIL}${categoryId}`);
    }
  }

  /**
   * Invalidate comment, job detail, and job list caches (ratings and review counts appear on cards).
   */
  async invalidateCommentCaches(jobId: number): Promise<void> {
    await this.del(`${CACHE_KEYS.COMMENT_BY_JOB}${jobId}`);
    await this.invalidateJobDetail(jobId);
    await this.delByPattern(`${CACHE_KEYS.JOB_LIST}*`);
  }

  /**
   * Clear all cache entries in the "jobaura:cache:" namespace.
   */
  async reset(): Promise<void> {
    if (this.client) {
      await this.delByPattern('*');
      return;
    }

    this.localCache.clear();
  }

  private async unlinkBatch(keys: string[]): Promise<void> {
    if (!this.client || keys.length === 0) return;
    if (this.client.unlink) {
      await this.client.unlink(keys);
    } else {
      await this.client.del(keys);
    }
  }

  private getLocal<T>(namespacedKey: string): T | undefined {
    const entry = this.localCache.get(namespacedKey);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.localCache.delete(namespacedKey);
      return undefined;
    }

    // Move recently read key to the newest position (LRU order).
    this.localCache.delete(namespacedKey);
    this.localCache.set(namespacedKey, entry);
    return entry.value as T;
  }

  private setLocal(namespacedKey: string, value: unknown, ttlMs: number): void {
    const now = Date.now();
    this.localCache.delete(namespacedKey);

    if (this.localCache.size >= this.maxLocalEntries) {
      this.pruneExpiredLocalCache(now);
    }

    while (this.localCache.size >= this.maxLocalEntries) {
      const oldestKey = this.localCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey === undefined) break;
      this.localCache.delete(oldestKey);
    }

    this.localCache.set(namespacedKey, {
      value,
      expiresAt: now + ttlMs,
    });
  }

  private pruneExpiredLocalCache(now: number): void {
    for (const [key, entry] of this.localCache) {
      if (entry.expiresAt <= now) {
        this.localCache.delete(key);
      }
    }
  }

  private acquireLocalLock(
    namespacedKey: string,
    token: string,
    ttlMs: number,
  ): string | undefined {
    const now = Date.now();
    this.pruneExpiredLocalLocks(now);

    const current = this.localLocks.get(namespacedKey);
    if (current && current.expiresAt > now) {
      return undefined;
    }

    this.localLocks.set(namespacedKey, {
      token,
      expiresAt: now + ttlMs,
    });
    return token;
  }

  private pruneExpiredLocalLocks(now: number): void {
    for (const [key, entry] of this.localLocks) {
      if (entry.expiresAt <= now) {
        this.localLocks.delete(key);
      }
    }
  }

  private resolveTtlMs(ttl?: number): number {
    if (ttl !== undefined && ttl > 0) {
      return Math.max(1, Math.floor(ttl));
    }
    return DEFAULT_CACHE_TTL_MS;
  }

  private patternToRegExp(glob: string): RegExp {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexBody = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${regexBody}$`);
  }

  private markRedisHealthy(): void {
    this.redisErrorLogged = false;
  }

  private warnOnce(operation: string, error: unknown): void {
    if (this.redisErrorLogged) return;
    this.redisErrorLogged = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Redis cache ${operation} failed (${reason}). Degrading gracefully until Redis recovers.`,
    );
  }

  private key(key: string): string {
    return `${this.namespace}${key}`;
  }
}
