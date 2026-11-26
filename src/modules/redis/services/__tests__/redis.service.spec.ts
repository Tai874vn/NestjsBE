import { Logger } from '@nestjs/common';
import { CACHE_KEYS, RedisCacheClient, RedisService } from '../redis.service';

type MockRedisClient = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  unlink: jest.Mock;
  scanIterator: jest.Mock;
  incr: jest.Mock;
  decr: jest.Mock;
  pExpire: jest.Mock;
  eval: jest.Mock;
};

function createAsyncChunks(
  chunks: Array<string | string[]>,
): AsyncIterable<string | string[]> {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createFailingAsyncIterable(
  error: Error,
): AsyncIterable<string | string[]> {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      yield* [];
      throw error;
    },
  };
}

function createMockRedisClient(
  overrides: Partial<MockRedisClient> = {},
): MockRedisClient {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    unlink: jest.fn().mockResolvedValue(1),
    scanIterator: jest.fn(() => createAsyncChunks([])),
    incr: jest.fn().mockResolvedValue(1),
    decr: jest.fn().mockResolvedValue(0),
    pExpire: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

describe('RedisService with mocked Redis client', () => {
  it('stores and reads JSON values under the jobaura:cache: namespace', async () => {
    const store = new Map<string, string>();
    const client = createMockRedisClient({
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
    });
    const service = new RedisService(client as unknown as RedisCacheClient);

    await service.set('job:menu', { ok: true }, 60_000);
    const result = await service.get<{ ok: boolean }>('job:menu');

    expect(client.set).toHaveBeenCalledWith(
      'jobaura:cache:job:menu',
      JSON.stringify({ ok: true }),
      { PX: 60_000 },
    );
    expect(result).toEqual({ ok: true });
  });

  it('deletes matching keys with scanIterator and unlink', async () => {
    const client = createMockRedisClient({
      scanIterator: jest.fn(() =>
        createAsyncChunks([
          ['jobaura:cache:job:list:1', 'jobaura:cache:job:list:2'],
          'jobaura:cache:job:list:3',
        ]),
      ),
    });
    const service = new RedisService(client as unknown as RedisCacheClient);

    await service.delByPattern('job:list:*');

    expect(client.scanIterator).toHaveBeenCalledWith({
      MATCH: 'jobaura:cache:job:list:*',
      COUNT: 100,
    });
    expect(client.unlink).toHaveBeenCalledWith([
      'jobaura:cache:job:list:1',
      'jobaura:cache:job:list:2',
      'jobaura:cache:job:list:3',
    ]);
  });

  it('acquires and releases distributed locks using SET NX PX and Lua eval', async () => {
    const client = createMockRedisClient();
    const service = new RedisService(client as unknown as RedisCacheClient);

    const token = await service.acquireLock('ai:run:1', 30_000);
    expect(token).toEqual(expect.any(String));
    expect(client.set).toHaveBeenCalledWith(
      'jobaura:cache:lock:ai:run:1',
      token,
      { NX: true, PX: 30_000 },
    );

    await service.releaseLock('ai:run:1', token!);
    expect(client.eval).toHaveBeenCalledWith(expect.stringContaining('del'), {
      keys: ['jobaura:cache:lock:ai:run:1'],
      arguments: [token],
    });
  });

  it('resets only keys inside the cache namespace', async () => {
    const client = createMockRedisClient({
      scanIterator: jest.fn(() =>
        createAsyncChunks([
          ['jobaura:cache:job:menu', 'jobaura:cache:category:list'],
        ]),
      ),
    });
    const service = new RedisService(client as unknown as RedisCacheClient);

    await service.reset();

    expect(client.scanIterator).toHaveBeenCalledWith({
      MATCH: 'jobaura:cache:*',
      COUNT: 100,
    });
    expect(client.unlink).toHaveBeenCalledWith([
      'jobaura:cache:job:menu',
      'jobaura:cache:category:list',
    ]);
  });
});

describe('RedisService in-process fallback store (no Redis client)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-25T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('supports pattern deletes without touching unrelated keys', async () => {
    const service = new RedisService(null);

    await service.set('job:list:page:1', ['a'], 60_000);
    await service.set('job:list:page:2', ['b'], 60_000);
    await service.set('job:detail:1', { id: 1 }, 60_000);

    await service.delByPattern('job:list:*');

    await expect(service.get('job:list:page:1')).resolves.toBeUndefined();
    await expect(service.get('job:list:page:2')).resolves.toBeUndefined();
    await expect(service.get('job:detail:1')).resolves.toEqual({ id: 1 });
  });

  it('expires entries after TTL and bounds the map size', async () => {
    const service = new RedisService(null, 3);

    await service.set('k1', 1, 10_000);
    await service.set('k2', 2, 10_000);
    await service.set('k3', 3, 10_000);
    // Reading k1 refreshes its recency so k2 is evicted next.
    await expect(service.get('k1')).resolves.toBe(1);
    await service.set('k4', 4, 10_000);

    await expect(service.get('k2')).resolves.toBeUndefined();
    await expect(service.get('k1')).resolves.toBe(1);
    await expect(service.get('k4')).resolves.toBe(4);

    jest.advanceTimersByTime(10_001);
    await expect(service.get('k1')).resolves.toBeUndefined();
  });

  it('clears all keys on reset()', async () => {
    const service = new RedisService(null);
    await service.set('a', 1, 60_000);
    await service.set('b', 2, 60_000);

    await service.reset();

    await expect(service.get('a')).resolves.toBeUndefined();
    await expect(service.get('b')).resolves.toBeUndefined();
  });

  it('prunes expired local locks so the lock map does not grow without bound', async () => {
    const service = new RedisService(null);

    const token1 = await service.acquireLock('job-1', 1_000);
    const token2 = await service.acquireLock('job-2', 1_000);
    expect(token1).toBeDefined();
    expect(token2).toBeDefined();
    // Active lock rejects second caller.
    await expect(service.acquireLock('job-1', 1_000)).resolves.toBeUndefined();

    jest.advanceTimersByTime(1_500);

    const token3 = await service.acquireLock('job-3', 5_000);
    expect(token3).toBeDefined();
    // Expired job-1 and job-2 were pruned when job-3 was acquired.
    const internalLocks = (
      service as unknown as { localLocks: Map<string, unknown> }
    ).localLocks;
    expect(internalLocks.size).toBe(1);
    expect(internalLocks.has('jobaura:cache:lock:job-3')).toBe(true);
  });
});

describe('RedisService when Redis is down', () => {
  const downError = () => Promise.reject(new Error('The client is closed'));

  it('degrades every operation without throwing and logs a warning only once per outage', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const client = createMockRedisClient({
      get: jest.fn().mockImplementation(downError),
      set: jest.fn().mockImplementation(downError),
      del: jest.fn().mockImplementation(downError),
      unlink: jest.fn().mockImplementation(downError),
      scanIterator: jest.fn(() =>
        createFailingAsyncIterable(new Error('The client is closed')),
      ),
      incr: jest.fn().mockImplementation(downError),
      decr: jest.fn().mockImplementation(downError),
      eval: jest.fn().mockImplementation(downError),
    });
    const service = new RedisService(client as unknown as RedisCacheClient);

    await expect(service.get('k')).resolves.toBeUndefined();
    await expect(service.set('k', 1)).resolves.toBeUndefined();
    await expect(service.del('k')).resolves.toBeUndefined();
    await expect(service.delByPattern('job:*')).resolves.toBeUndefined();
    await expect(service.increment('counter', 1000)).resolves.toBe(0);
    await expect(service.decrement('counter', 1000)).resolves.toBe(0);
    await expect(service.reset()).resolves.toBeUndefined();
    const lockToken = await service.acquireLock('run:1', 5000);
    expect(lockToken).toBeDefined();
    await expect(
      service.releaseLock('run:1', lockToken!),
    ).resolves.toBeUndefined();
    await expect(
      service.getOrSet('k', () => Promise.resolve('from db')),
    ).resolves.toBe('from db');

    // Warning logged once for the outage rather than spamming on every call.
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Once Redis recovers and fails again later, it logs once for the new outage.
    client.get.mockResolvedValueOnce(JSON.stringify('ok'));
    await expect(service.get('k')).resolves.toBe('ok');
    client.get.mockImplementationOnce(downError);
    await expect(service.get('k')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });
});

describe('RedisService single-flight getOrSet', () => {
  it('coalesces concurrent misses into a single factory call', async () => {
    const service = new RedisService(null);
    let resolveFactory!: (value: string) => void;
    const factory = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFactory = resolve;
        }),
    );

    const p1 = service.getOrSet('hot:key', factory, 60_000);
    const p2 = service.getOrSet('hot:key', factory, 60_000);
    const p3 = service.getOrSet('hot:key', factory, 60_000);

    await Promise.resolve();
    resolveFactory('computed-once');

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([
      'computed-once',
      'computed-once',
      'computed-once',
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    // Subsequent call reads from cache without running factory again.
    await expect(service.getOrSet('hot:key', factory, 60_000)).resolves.toBe(
      'computed-once',
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight entry if the factory rejects so the next call retries', async () => {
    const service = new RedisService(null);
    const factory = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce('recovered');

    await expect(service.getOrSet('retry:key', factory)).rejects.toThrow(
      'db blip',
    );
    await expect(service.getOrSet('retry:key', factory)).resolves.toBe(
      'recovered',
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('RedisService invalidations', () => {
  it('invalidateJobCaches clears both job detail keys and category:detail:*', async () => {
    const client = createMockRedisClient();
    const service = new RedisService(client as unknown as RedisCacheClient);

    await service.invalidateJobCaches(562);

    const deleted = client.del.mock.calls.map(([key]: [string]) => key);
    const scannedPatterns = client.scanIterator.mock.calls.map(
      ([opts]: [{ MATCH: string }]) => opts.MATCH,
    );

    expect(deleted).toEqual(
      expect.arrayContaining([
        'jobaura:cache:job:menu',
        'jobaura:cache:job:detail:562',
        'jobaura:cache:job:detail:full:562',
      ]),
    );
    expect(scannedPatterns).toEqual(
      expect.arrayContaining([
        'jobaura:cache:job:list:*',
        'jobaura:cache:job:search:*',
        'jobaura:cache:job:category:*',
        'jobaura:cache:category:detail:*',
      ]),
    );
  });

  it('invalidateCommentCaches clears comments, job detail keys, and job:list:*', async () => {
    const client = createMockRedisClient();
    const service = new RedisService(client as unknown as RedisCacheClient);

    await service.invalidateCommentCaches(562);

    const deleted = client.del.mock.calls.map(([key]: [string]) => key);
    const scannedPatterns = client.scanIterator.mock.calls.map(
      ([opts]: [{ MATCH: string }]) => opts.MATCH,
    );

    expect(deleted).toEqual(
      expect.arrayContaining([
        `jobaura:cache:${CACHE_KEYS.COMMENT_BY_JOB}562`,
        'jobaura:cache:job:detail:562',
        'jobaura:cache:job:detail:full:562',
      ]),
    );
    expect(scannedPatterns).toContain('jobaura:cache:job:list:*');
  });

  it('invalidateCategoryCaches clears category keys and job:list:*', async () => {
    const client = createMockRedisClient();
    const service = new RedisService(client as unknown as RedisCacheClient);

    await service.invalidateCategoryCaches(7);

    const deleted = client.del.mock.calls.map(([key]: [string]) => key);
    const scannedPatterns = client.scanIterator.mock.calls.map(
      ([opts]: [{ MATCH: string }]) => opts.MATCH,
    );

    expect(deleted).toEqual(
      expect.arrayContaining([
        'jobaura:cache:category:list',
        'jobaura:cache:job:menu',
        'jobaura:cache:category:7',
        'jobaura:cache:category:detail:7',
      ]),
    );
    expect(scannedPatterns).toEqual(
      expect.arrayContaining([
        'jobaura:cache:job:list:*',
        'jobaura:cache:job:category:*',
      ]),
    );
  });

  it('invalidateUserProfile clears user:profile:<id>', async () => {
    const client = createMockRedisClient();
    const service = new RedisService(client as unknown as RedisCacheClient);

    await service.invalidateUserProfile(42);

    expect(client.del).toHaveBeenCalledWith('jobaura:cache:user:profile:42');
  });
});
