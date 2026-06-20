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
