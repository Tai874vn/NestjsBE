import { HiringPostStatus } from '@prisma/client';
import { RecommendationDataLoaderService } from './recommendation-data-loader.service';

describe('RecommendationDataLoaderService.loadOpenHiringPosts', () => {
  it('loads open posts from other recruiters that are not past their closing date', async () => {
    const prisma = { hiringPost: { findMany: jest.fn().mockResolvedValue([]) } };

    await new RecommendationDataLoaderService(prisma as never).loadOpenHiringPosts(7, 50);

    expect(prisma.hiringPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        where: {
          status: HiringPostStatus.OPEN,
          recruiterId: { not: 7 },
          OR: [{ closesAt: null }, { closesAt: { gt: expect.any(Date) } }],
        },
      }),
    );
  });
});
