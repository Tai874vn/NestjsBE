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
