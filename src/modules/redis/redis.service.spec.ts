import { RedisService } from './redis.service';

describe('RedisService invalidation', () => {
  it('starts matching cache deletions concurrently', async () => {
    const releases: Array<() => void> = [];
    const cacheManager = {
      keys: jest.fn().mockResolvedValue(['job:1', 'job:2', 'job:3']),
      del: jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      ),
    };
    const service = new RedisService(cacheManager as never);

    const invalidation = service.delByPattern('job:*');
    await Promise.resolve();
    await Promise.resolve();

    expect(cacheManager.del).toHaveBeenCalledTimes(3);
    releases.forEach((release) => release());
    await invalidation;
  });
});

describe('RedisService when Redis is down', () => {
  const down = () => {
    throw new Error('The client is closed');
  };
  const cacheManager = {
    get: jest.fn().mockImplementation(down),
    set: jest.fn().mockImplementation(down),
    del: jest.fn().mockImplementation(down),
  };

  it('treats a failed read as a cache miss', async () => {
    await expect(new RedisService(cacheManager as never).get('k')).resolves.toBeUndefined();
  });

  it('serves the value from the source when caching fails', async () => {
    const service = new RedisService(cacheManager as never);
    await expect(service.getOrSet('k', () => Promise.resolve('from db'))).resolves.toBe('from db');
  });

  it('does not fail writes or deletes', async () => {
    const service = new RedisService(cacheManager as never);
    await expect(service.set('k', 1)).resolves.toBeUndefined();
    await expect(service.del('k')).resolves.toBeUndefined();
  });
});

describe('RedisService job detail invalidation', () => {
  // The details endpoint caches under "job:detail:full:<id>", so a change or a delete must clear that key too,
  // or a deleted post keeps being served from the cache.
  const deletedKeys = async (run: (service: RedisService) => Promise<void>) => {
    const cacheManager = { del: jest.fn().mockResolvedValue(undefined), keys: jest.fn().mockResolvedValue([]) };
    await run(new RedisService(cacheManager as never));
    return cacheManager.del.mock.calls.map(([key]: [string]) => key);
  };

  it('clears both detail keys of a job after a job change', async () => {
    const keys = await deletedKeys((service) => service.invalidateJobCaches(562));
    expect(keys).toEqual(expect.arrayContaining([expect.stringMatching(/job:detail:562$/), expect.stringMatching(/job:detail:full:562$/)]));
  });

  it('clears both detail keys of a job after a comment change', async () => {
    const keys = await deletedKeys((service) => service.invalidateCommentCaches(562));
    expect(keys).toEqual(expect.arrayContaining([expect.stringMatching(/job:detail:562$/), expect.stringMatching(/job:detail:full:562$/)]));
  });
});
