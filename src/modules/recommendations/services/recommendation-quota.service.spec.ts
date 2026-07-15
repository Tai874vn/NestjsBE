import { HttpException } from '@nestjs/common';
import { RecommendationQuotaService } from './recommendation-quota.service';

const redis = {
  get: jest.fn(),
  increment: jest.fn(),
  decrement: jest.fn(),
};

describe('RecommendationQuotaService', () => {
  let service: RecommendationQuotaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecommendationQuotaService(redis as any);
  });

  it('reads the current daily quota from Redis', async () => {
    redis.get.mockResolvedValue(2);

    const quota = await service.getQuotaForUser(42);

    expect(redis.get).toHaveBeenCalledWith(expect.stringMatching(/^ai:recommendations:quota:42:/));
    expect(quota).toMatchObject({ limit: 5, used: 2, remaining: 3 });
    expect(new Date(quota.resetAt).getUTCHours()).toBe(0);
  });

  it('consumes one quota use and keeps the key expiring at the daily window', async () => {
    redis.increment.mockResolvedValue(3);

    const quota = await service.consume(42);

    expect(redis.increment).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:recommendations:quota:42:/),
      expect.any(Number),
    );
    expect(quota).toMatchObject({ limit: 5, used: 3, remaining: 2 });
  });

  it('rolls back and throws when the daily quota is exceeded', async () => {
    redis.increment.mockResolvedValue(6);
    redis.decrement.mockResolvedValue(5);

    await expect(service.consume(42)).rejects.toBeInstanceOf(HttpException);
    expect(redis.decrement).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:recommendations:quota:42:/),
      expect.any(Number),
    );
  });
});
