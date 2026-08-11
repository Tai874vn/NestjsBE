import { HttpException } from '@nestjs/common';
import { RecommendationQuotaService } from './recommendation-quota.service';

const redis = {
  get: jest.fn(),
  set: jest.fn(),
};

const quotaUsage = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
};

const prisma = {
  recommendationQuotaUsage: quotaUsage,
  $transaction: jest.fn((callback: (tx: { recommendationQuotaUsage: typeof quotaUsage }) => Promise<unknown>) =>
    callback({ recommendationQuotaUsage: quotaUsage }),
  ),
};

describe('RecommendationQuotaService', () => {
  let service: RecommendationQuotaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecommendationQuotaService(redis as any, prisma as any);
  });

  it('reads the current daily quota from the database and refreshes Redis', async () => {
    quotaUsage.findUnique.mockResolvedValue({ used: 2 });

    const quota = await service.getQuotaForUser(42);

    expect(quotaUsage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_day: expect.objectContaining({ userId: 42 }) },
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:recommendations:quota:42:/),
      2,
      expect.any(Number),
    );
    expect(quota).toMatchObject({ limit: 5, used: 2, remaining: 3 });
    expect(new Date(quota.resetAt).getUTCHours()).toBe(0);
  });

  it('gives admins a larger daily testing quota', async () => {
    quotaUsage.findUnique.mockResolvedValue({ used: 7 });

    const quota = await service.getQuotaForUser(42, 'admin');

    expect(quota).toMatchObject({ limit: 100, used: 7, remaining: 93 });
  });

  it('reserves one quota use in the database and refreshes Redis', async () => {
    quotaUsage.upsert.mockResolvedValue({ used: 3 });

    const quota = await service.reserve(42);

    expect(quotaUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_day: expect.objectContaining({ userId: 42 }) },
        update: { used: { increment: 1 } },
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:recommendations:quota:42:/),
      3,
      expect.any(Number),
    );
    expect(quota).toMatchObject({ limit: 5, used: 3, remaining: 2 });
  });

  it('rolls back and throws when the daily quota is exceeded', async () => {
    quotaUsage.upsert.mockResolvedValue({ used: 6 });
    quotaUsage.update.mockResolvedValue({ used: 5 });

    await expect(service.reserve(42)).rejects.toBeInstanceOf(HttpException);
    expect(quotaUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { used: { decrement: 1 } },
      }),
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('refunds a reserved quota use', async () => {
    quotaUsage.findUnique.mockResolvedValue({ used: 3 });
    quotaUsage.update.mockResolvedValue({ used: 2 });

    const quota = await service.refund(42);

    expect(quotaUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { used: { decrement: 1 } },
      }),
    );
    expect(quota).toMatchObject({ limit: 5, used: 2, remaining: 3 });
  });
});
