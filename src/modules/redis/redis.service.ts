import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { randomUUID } from 'crypto';

// Define cache interface for compatibility
interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  reset?(): Promise<void>;
  keys?(pattern: string): Promise<string[]>;
  scan?(pattern: string): Promise<string[]>;
  unlink?(keys: string[]): Promise<void>;
  store?: {
    keys?: (pattern: string) => Promise<string[]>;
    scan?: (pattern: string) => Promise<string[]>;
    unlink?: (keys: string[]) => Promise<void>;
    client?: {
      incr?: (key: string) => Promise<number>;
      decr?: (key: string) => Promise<number>;
      pExpire?: (key: string, ttlMs: number) => Promise<unknown>;
      set?: (
        key: string,
        value: string,
        options: { NX: true; PX: number },
      ) => Promise<string | null>;
      eval?: (
        script: string,
        options: { keys: string[]; arguments: string[] },
      ) => Promise<unknown>;
      quit?: () => Promise<unknown>;
      isOpen?: boolean;
    };
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
export class RedisService implements OnModuleDestroy {
  private readonly namespace = 'jobaura:cache:';
  private readonly localLocks = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(@Inject(CACHE_MANAGER) private cacheManager: CacheStore) {}

  async onModuleDestroy(): Promise<void> {
    const client = this.cacheManager.store?.client;
    if (client?.quit && client.isOpen !== false) {
      await client.quit();
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | undefined> {
    // The cache is an optimisation: while Redis is down, read from the source instead of failing.
    try {
      return await this.cacheManager.get<T>(this.key(key));
    } catch {
      return undefined;
    }
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    try {
      await this.cacheManager.set(this.key(key), value, ttl);
    } catch {
      // Not cached this time; the next read goes to the source.
    }
  }

  /**
   * Delete a specific key from cache
   */
  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(this.key(key));
    } catch {
      // Redis is down. If it comes back with this key, the entry still expires with its TTL.
    }
  }

  async increment(key: string, ttl?: number): Promise<number> {
    const client = this.cacheManager.store?.client;
    if (client?.incr) {
      const namespacedKey = this.key(key);
      const value = await client.incr(namespacedKey);
      if (value === 1 && ttl && client.pExpire) {
        await client.pExpire(namespacedKey, ttl);
      }
      return value;
    }

    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.set(key, next, ttl);
    return next;
  }

  async decrement(key: string, ttl?: number): Promise<number> {
    const client = this.cacheManager.store?.client;
    if (client?.decr) {
      const namespacedKey = this.key(key);
      const value = await client.decr(namespacedKey);
      if (ttl && client.pExpire) {
        await client.pExpire(namespacedKey, ttl);
      }
      return value;
    }

    const current = (await this.get<number>(key)) ?? 0;
    const next = Math.max(0, current - 1);
    await this.set(key, next, ttl);
    return next;
  }

  /**
   * Delete multiple keys matching a pattern
   * Note: This requires the Redis store to support keys() method
   */
  async delByPattern(pattern: string): Promise<void> {
    let keys: string[] = [];
    const namespacedPattern = this.key(pattern);

    if (this.cacheManager.scan) {
      keys = await this.cacheManager.scan(namespacedPattern);
    } else if (this.cacheManager.store?.scan) {
      keys = await this.cacheManager.store.scan(namespacedPattern);
    } else if (this.cacheManager.keys) {
      keys = await this.cacheManager.keys(namespacedPattern);
    } else if (this.cacheManager.store?.keys) {
      keys = await this.cacheManager.store.keys(namespacedPattern);
    }

    if (this.cacheManager.unlink) {
      await this.cacheManager.unlink(keys);
    } else if (this.cacheManager.store?.unlink) {
      await this.cacheManager.store.unlink(keys);
    } else {
      await Promise.all(keys.map((key) => this.cacheManager.del(key)));
    }
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | undefined> {
    const namespacedKey = this.key(`lock:${key}`);
    const token = randomUUID();
    const client = this.cacheManager.store?.client;
    if (client?.set) {
      const result = await client.set(namespacedKey, token, {
        NX: true,
        PX: ttlMs,
      });
      return result === 'OK' ? token : undefined;
    }

    const current = this.localLocks.get(namespacedKey);
    if (current && current.expiresAt > Date.now()) return undefined;
    this.localLocks.set(namespacedKey, {
      token,
      expiresAt: Date.now() + ttlMs,
    });
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const namespacedKey = this.key(`lock:${key}`);
    const client = this.cacheManager.store?.client;
    if (client?.eval) {
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [namespacedKey], arguments: [token] },
      );
      return;
    }

    if (this.localLocks.get(namespacedKey)?.token === token) {
      this.localLocks.delete(namespacedKey);
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
    await this.invalidateJobDetail(jobId);
  }

  /**
   * Reset all caches
   */
  async reset(): Promise<void> {
    if (
      this.cacheManager.scan ||
      this.cacheManager.store?.scan ||
      this.cacheManager.keys ||
      this.cacheManager.store?.keys
    ) {
      await this.delByPattern('*');
    } else if (this.cacheManager.reset) {
      await this.cacheManager.reset();
    } else if (this.cacheManager.store?.reset) {
      await this.cacheManager.store.reset();
    }
  }

  private key(key: string): string {
    return `${this.namespace}${key}`;
  }
}
