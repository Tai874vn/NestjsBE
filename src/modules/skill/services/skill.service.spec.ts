import { SkillService } from './skill.service';

describe('SkillService search caching rules', () => {
  const createService = () => {
    const prisma = { userSkill: { findMany: jest.fn() } };
    const redis = {
      getOrSet: jest.fn((_key: string, loader: () => Promise<unknown>) =>
        loader(),
      ),
    };
    const aiClient = {
      searchSkills: jest.fn().mockResolvedValue([{ id: '1', name: 'React Native' }]),
      extractSkills: jest.fn(),
      fieldsOfStudy: jest.fn(),
      resolveSkills: jest.fn(),
    };
    const service = new SkillService(
      prisma as never,
      redis as never,
      aiClient as never,
    );
    return { service, redis, aiClient };
  };

  it('normalises whitespace and case, and caches queries up to 40 chars for 5 minutes', async () => {
    const { service, redis, aiClient } = createService();

    await service.search('  React   Native  ', '  2512.3 ', 15);

    expect(redis.getOrSet).toHaveBeenCalledWith(
      'skill:list:search:2512.3:15:react native',
      expect.any(Function),
      5 * 60 * 1000,
    );
    expect(aiClient.searchSkills).toHaveBeenCalledWith(
      'react native',
      '2512.3',
      15,
    );

    // Exactly 40 characters after normalisation is still allowed.
    redis.getOrSet.mockClear();
    const boundaryQuery = 'a'.repeat(40);
    await service.search(boundaryQuery);
    expect(redis.getOrSet).toHaveBeenCalledTimes(1);
  });

  it('skips caching when the normalised query is longer than 40 characters', async () => {
    const { service, redis, aiClient } = createService();
    const longQuery = 'a'.repeat(41);

    const result = await service.search(longQuery);

    expect(redis.getOrSet).not.toHaveBeenCalled();
    expect(aiClient.searchSkills).toHaveBeenCalledWith(longQuery, undefined, 10);
    expect(result.content).toEqual([{ id: '1', name: 'React Native' }]);
  });

  it('returns an empty list without calling AI or Redis for blank queries', async () => {
    const { service, redis, aiClient } = createService();

    const result = await service.search('    ');

    expect(result).toEqual({ message: 'Search skills successfully', content: [] });
    expect(redis.getOrSet).not.toHaveBeenCalled();
    expect(aiClient.searchSkills).not.toHaveBeenCalled();
  });
});
