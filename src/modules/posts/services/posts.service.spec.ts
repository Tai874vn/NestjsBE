import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { PostsService } from './posts.service';

describe('PostsService social feed', () => {
  const createService = () => {
    const prisma = {
      post: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      connection: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      postLike: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
      },
      postComment: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      savedPost: {
        findMany: jest.fn(),
      },
    };
    const cloudinary = { deleteImage: jest.fn() };
    const service = new PostsService(prisma as never, cloudinary as never);
    return { service, prisma, cloudinary };
  };

  it('returns newest posts with a stable next cursor and viewer like state', async () => {
    const { service, prisma } = createService();
    const author = { id: 4, name: 'Lina', avatar: null, headline: 'Designer' };
    const makePost = (id: number) => ({
      id,
      content: `Post ${id}`,
      imageUrl: null,
      createdAt: new Date(`2026-06-${id}T00:00:00.000Z`),
      updatedAt: new Date(`2026-06-${id}T00:00:00.000Z`),
      author,
      likes: id === 9 ? [{ userId: 6 }] : [],
      savedBy: id === 10 ? [{ userId: 6 }] : [],
      comments: [],
      _count: { likes: id, comments: 0 },
    });
    prisma.post.findMany.mockResolvedValue([makePost(10), makePost(9), makePost(8)]);

    const result = await service.getFeed(6, { limit: 2 });

    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: { id: 'desc' },
        include: expect.objectContaining({
          comments: expect.objectContaining({
            take: 5,
            orderBy: { id: 'desc' },
          }),
        }),
      }),
    );
    expect(result.content.data.map((post) => post.id)).toEqual([10, 9]);
    expect(result.content.data[1].viewerHasLiked).toBe(true);
    expect(result.content.data[0].viewerHasSaved).toBe(true);
    expect(typeof result.content.nextCursor).toBe('string');
  });

  it('fills a page with connection posts first and then global posts', async () => {
    const { service, prisma } = createService();
    prisma.connection.findMany.mockResolvedValue([
      { requesterId: 6, recipientId: 8 },
    ]);
    const makePost = (id: number, authorId: number) => ({
      id,
      content: `Post ${id}`,
      imageUrl: null,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
      updatedAt: new Date('2026-06-19T00:00:00.000Z'),
      author: { id: authorId, name: `User ${authorId}`, avatar: null, headline: null },
      likes: [],
      savedBy: [],
      comments: [],
      _count: { likes: 0, comments: 0 },
    });
    prisma.post.findMany
      .mockResolvedValueOnce([makePost(20, 8), makePost(19, 6)])
      .mockResolvedValueOnce([makePost(30, 10), makePost(29, 11)]);

    const result = await service.getFeed(6, { limit: 3 });

    expect(result.content.data.map((post) => post.id)).toEqual([20, 19, 30]);
    expect(prisma.post.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ authorId: { in: [6, 8] } }),
      }),
    );
    expect(prisma.post.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ authorId: { notIn: [6, 8] } }),
      }),
    );
    expect(typeof result.content.nextCursor).toBe('string');
  });

  it('creates and removes an idempotent like', async () => {
    const { service, prisma } = createService();
    prisma.post.findUnique.mockResolvedValue({ id: 10 });
    prisma.postLike.upsert.mockResolvedValue({ postId: 10, userId: 6 });
    prisma.postLike.deleteMany.mockResolvedValue({ count: 1 });

    await service.likePost(10, 6);
    await service.unlikePost(10, 6);

    expect(prisma.postLike.upsert).toHaveBeenCalledWith({
      where: { postId_userId: { postId: 10, userId: 6 } },
      create: { postId: 10, userId: 6 },
      update: {},
    });
    expect(prisma.postLike.deleteMany).toHaveBeenCalledWith({ where: { postId: 10, userId: 6 } });
  });

  it('only lets the author or admin delete a post and cleans up its image', async () => {
    const { service, prisma, cloudinary } = createService();
    prisma.post.findUnique.mockResolvedValue({ authorId: 4, imagePublicId: 'posts/image-1' });

    await expect(service.deletePost(10, 6, Role.USER)).rejects.toBeInstanceOf(ForbiddenException);

    await service.deletePost(10, 4, Role.USER);
    expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    expect(cloudinary.deleteImage).toHaveBeenCalledWith('posts/image-1');
  });

  it('rejects comments for a missing post', async () => {
    const { service, prisma } = createService();
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(service.createComment(404, 6, { content: 'Hello' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a comment author edit their comment and trims the content', async () => {
    const { service, prisma } = createService();
    prisma.postComment.findUnique.mockResolvedValue({ postId: 10, authorId: 6 });
    prisma.postComment.update.mockResolvedValue({ id: 4, postId: 10, authorId: 6, content: 'Updated' });

    const result = await service.updateComment(10, 4, 6, { content: '  Updated  ' });

    expect(prisma.postComment.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { content: 'Updated' },
      include: { author: { select: { id: true, name: true, avatar: true, headline: true } } },
    });
    expect(result.content.content).toBe('Updated');
  });

  it('does not let another user edit a comment', async () => {
    const { service, prisma } = createService();
    prisma.postComment.findUnique.mockResolvedValue({ postId: 10, authorId: 7 });

    await expect(service.updateComment(10, 4, 6, { content: 'Changed' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.postComment.update).not.toHaveBeenCalled();
  });

  it('returns real post and reaction totals for the identity rail', async () => {
    const { service, prisma } = createService();
    prisma.post.count.mockResolvedValue(4);
    prisma.postLike.count.mockResolvedValue(18);

    const result = await service.getMyStats(6);

    expect(prisma.post.count).toHaveBeenCalledWith({ where: { authorId: 6 } });
    expect(prisma.postLike.count).toHaveBeenCalledWith({ where: { post: { authorId: 6 } } });
    expect(result.content).toEqual({ posts: 4, reactions: 18 });
  });
});
