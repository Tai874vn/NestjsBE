import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertPortfolioItemDto } from '../../dto/profile.dto';
import { ProfileCompletionService } from '../profile-completion.service';
import { UserPortfolioService } from '../user-portfolio.service';

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
    const storage = {
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    const profileCompletionService = new ProfileCompletionService(
      prisma as any,
    );
    const service = new UserPortfolioService(
      prisma as any,
      redisService as any,
      profileCompletionService,
      storage as any,
    );

    return { service, prisma, redisService, storage };
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

  it('allows both migrated local portfolio image paths and external http(s) URLs in UpsertPortfolioItemDto (Finding 5)', async () => {
    const localUrl =
      '/uploads/images/portfolio/550e8400-e29b-41d4-a716-446655440000.webp';

    const localErrors = await validate(
      plainToInstance(UpsertPortfolioItemDto, {
        title: 'Migrated item',
        image: localUrl,
      }),
    );
    expect(localErrors).toHaveLength(0);

    const externalErrors = await validate(
      plainToInstance(UpsertPortfolioItemDto, {
        title: 'External item',
        image: 'https://example.com/shot.png',
      }),
    );
    expect(externalErrors).toHaveLength(0);

    const badErrors = await validate(
      plainToInstance(UpsertPortfolioItemDto, {
        title: 'Bad item',
        image: 'javascript:alert(1)',
      }),
    );
    expect(badErrors.length).toBeGreaterThan(0);
  });

  it('deletes the replaced or removed local image on portfolio update and delete (Finding 5)', async () => {
    const { service, prisma, storage } = createService();
    const oldImage =
      '/uploads/images/portfolio/550e8400-e29b-41d4-a716-446655440000.webp';
    const nextImage =
      '/uploads/images/portfolio/660e8400-e29b-41d4-a716-446655440000.webp';

    prisma.user.findUnique.mockResolvedValue({
      name: 'Jane',
      avatar: null,
      headline: null,
      bio: null,
      profileSkills: [],
    });
    prisma.user.update.mockResolvedValue({ profileCompleted: false });
    prisma.userPortfolioItem.findUnique.mockResolvedValue({
      userId: 1,
      image: oldImage,
    });
    prisma.userPortfolioItem.update.mockResolvedValue({
      id: 10,
      userId: 1,
      title: 'Updated',
      image: nextImage,
    });

    await service.updatePortfolioItem(1, 10, {
      title: 'Updated',
      image: nextImage,
    });
    expect(storage.deleteImage).toHaveBeenCalledWith(oldImage);

    storage.deleteImage.mockClear();
    prisma.userPortfolioItem.findUnique.mockResolvedValue({
      userId: 1,
      image: nextImage,
    });
    prisma.userPortfolioItem.delete.mockResolvedValue({ id: 10 });

    await service.deletePortfolioItem(1, 10);
    expect(storage.deleteImage).toHaveBeenCalledWith(nextImage);
  });
});
