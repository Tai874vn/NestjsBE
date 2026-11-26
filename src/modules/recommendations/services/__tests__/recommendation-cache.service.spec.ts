import {
  RECOMMENDATION_CACHE_TTL_MS,
  RecommendationCacheService,
} from '../recommendation-cache.service';

const redis = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('RecommendationCacheService', () => {
  let service: RecommendationCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecommendationCacheService(redis as any);
  });

  it('stores job recommendations under a scoped five-minute key', async () => {
    const result = {
      data: [{ id: 10 }],
      model: 'model',
      elapsedMs: 12,
      generatedAt: '2026-07-11T00:00:00.000Z',
    };

    await service.setJobs(7, 10, 100, 'fingerprint', result);

    expect(redis.set).toHaveBeenCalledWith(
      'ai:recommendations:jobs:7:10:100:fingerprint',
      result,
      RECOMMENDATION_CACHE_TTL_MS,
    );
  });

  it('reads candidate recommendations by user, job, and query size', async () => {
    redis.get.mockResolvedValue({ data: [], model: 'model', elapsedMs: 5, generatedAt: 'now' });

    const result = await service.getCandidates(7, 99, 5, 50);

    expect(redis.get).toHaveBeenCalledWith('ai:recommendations:candidates:7:99:5:50');
    expect(result).toMatchObject({ model: 'model', data: [] });
  });
});
