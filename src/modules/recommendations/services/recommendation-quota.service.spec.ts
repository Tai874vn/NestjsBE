import { HttpException } from '@nestjs/common';
import { RecommendationQuotaService } from './recommendation-quota.service';

const quotaUsage = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
};

const prisma = {
  recommendationQuotaUsage: quotaUsage,
  $transaction: jest.fn(
    (
      callback: (tx: {
        recommendationQuotaUsage: typeof quotaUsage;
      }) => Promise<unknown>,
    ) => callback({ recommendationQuotaUsage: quotaUsage }),
  ),
};

describe('RecommendationQuotaService', () => {
  let service: RecommendationQuotaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecommendationQuotaService(prisma as never);
  });

  it('reads the current daily quota directly from the database without writing dead Redis keys', async () => {
    quotaUsage.findUnique.mockResolvedValue({ used: 2 });

    const quota = await service.getQuotaForUser(42);

    expect(quotaUsage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_day: expect.objectContaining({ userId: 42 }) },
      }),
    );
    expect(quota).toMatchObject({ limit: 5, used: 2, remaining: 3 });
    expect(new Date(quota.resetAt).getUTCHours()).toBe(0);
  });

  it('gives admins a larger daily testing quota', async () => {
    quotaUsage.findUnique.mockResolvedValue({ used: 7 });

    const quota = await service.getQuotaForUser(42, 'admin');

    expect(quota).toMatchObject({ limit: 100, used: 7, remaining: 93 });
  });

  it('reserves one quota use in the database', async () => {
    quotaUsage.upsert.mockResolvedValue({ used: 3 });

    const quota = await service.reserve(42);

    expect(quotaUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_day: expect.objectContaining({ userId: 42 }) },
        update: { used: { increment: 1 } },
      }),
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
