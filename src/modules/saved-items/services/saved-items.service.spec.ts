import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SavedItemsService } from './saved-items.service';

describe('SavedItemsService', () => {
  const createService = () => {
    const prisma = {
      post: { findUnique: jest.fn() },
      job: { findUnique: jest.fn() },
      savedPost: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
      savedJob: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
    };
    return {
      prisma,
      service: new SavedItemsService(prisma as never),
    };
  };

  it('saves and unsaves a post idempotently for the current user', async () => {
    const { service, prisma } = createService();
    prisma.post.findUnique.mockResolvedValue({ id: 8 });
    prisma.savedPost.upsert.mockResolvedValue({ userId: 4, postId: 8 });
    prisma.savedPost.deleteMany.mockResolvedValue({ count: 1 });

    await service.savePost(4, 8);
    await service.unsavePost(4, 8);

    expect(prisma.savedPost.upsert).toHaveBeenCalledWith({
      where: { userId_postId: { userId: 4, postId: 8 } },
      create: { userId: 4, postId: 8 },
      update: {},
    });
    expect(prisma.savedPost.deleteMany).toHaveBeenCalledWith({
      where: { userId: 4, postId: 8 },
    });
  });

  it('rejects saving a missing job', async () => {
    const { service, prisma } = createService();
    prisma.job.findUnique.mockResolvedValue(null);

    await expect(service.saveJob(4, 404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lists only the current user saved posts and exposes saved state', async () => {
    const { service, prisma } = createService();
    prisma.savedPost.findMany.mockResolvedValue([
      {
        userId: 4,
        postId: 9,
        createdAt: new Date('2026-06-19T10:00:00.000Z'),
        post: {
          id: 9,
          content: 'Saved post',
          imageUrl: null,
          createdAt: new Date('2026-06-19T09:00:00.000Z'),
          updatedAt: new Date('2026-06-19T09:00:00.000Z'),
          author: { id: 2, name: 'Maya', avatar: null, headline: null },
          likes: [],
          comments: [],
          _count: { likes: 2, comments: 1 },
        },
      },
    ]);

    const result = await service.getSavedPosts(4, { limit: 10 });

    expect(prisma.savedPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 4 }, take: 11 }),
    );
    expect(result.content.data[0]).toMatchObject({
      id: 9,
      viewerHasSaved: true,
      likeCount: 2,
      commentCount: 1,
    });
  });

  it('rejects saved item cursors with invalid target ids', async () => {
    const { service } = createService();
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-06-19T10:00:00.000Z',
        targetId: 0,
      }),
    ).toString('base64url');

    await expect(
      service.getSavedPosts(4, { cursor, limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
