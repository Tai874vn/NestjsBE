import { ForbiddenException } from '@nestjs/common';
import { ProfileCompletionService } from './profile-completion.service';
import { UserPortfolioService } from './user-portfolio.service';

describe('UserPortfolioService', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userPortfolioItem: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const redisService = {
      invalidateUserCaches: jest.fn(),
    };
    const profileCompletionService = new ProfileCompletionService(
      prisma as any,
    );
    const service = new UserPortfolioService(
      prisma as any,
      redisService as any,
      profileCompletionService,
    );

    return { service, prisma, redisService };
  };

  it('creates a portfolio item and refreshes profile completion', async () => {
    const { service, prisma, redisService } = createService();
    const item = {
      id: 10,
      userId: 1,
      title: 'API Platform',
      description: 'NestJS backend',
      image: null,
      url: 'https://example.com',
      sortOrder: 0,
    };

    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({
        name: 'Jane Doe',
        avatar: 'https://example.com/avatar.png',
        headline: 'Backend Developer',
        bio: 'Builds APIs',
        profileSkills: [{ id: 1 }],
      });
    prisma.userPortfolioItem.create.mockResolvedValue(item);
    prisma.user.update.mockResolvedValue({ profileCompleted: true });

    const result = await service.createPortfolioItem(1, {
      title: ' API Platform ',
      description: ' NestJS backend ',
      url: ' https://example.com ',
    });

    expect(prisma.userPortfolioItem.create).toHaveBeenCalledWith({
      data: {
        userId: 1,
        title: 'API Platform',
        description: 'NestJS backend',
        image: undefined,
        url: 'https://example.com',
        sortOrder: 0,
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { profileCompleted: true },
    });
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      message: 'Portfolio item created successfully',
      content: item,
    });
  });

  it('rejects portfolio updates for items owned by another user', async () => {
    const { service, prisma } = createService();

    prisma.userPortfolioItem.findUnique.mockResolvedValue({ userId: 99 });

    await expect(
      service.updatePortfolioItem(1, 10, {
        title: 'Updated',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.userPortfolioItem.update).not.toHaveBeenCalled();
  });
});
