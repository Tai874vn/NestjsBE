import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '../../../../common/constants/roles';
import { PostsService } from '../posts.service';

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
        create: jest.fn(),
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
    const storage = { deleteImage: jest.fn() };
    const notifications = {
      notifyPostLike: jest.fn(),
      notifyPostComment: jest.fn(),
    };
    const service = new PostsService(
      prisma as never,
      storage as never,
      notifications as never,
    );
    return { service, prisma, storage, notifications };
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
    const { service, prisma, notifications } = createService();
    prisma.post.findUnique.mockResolvedValue({ id: 10, authorId: 4, content: 'Post 10' });
    prisma.postLike.create.mockResolvedValue({ postId: 10, userId: 6 });
    prisma.postLike.deleteMany.mockResolvedValue({ count: 1 });

    await service.likePost(10, 6);
    await service.unlikePost(10, 6);

    expect(prisma.postLike.create).toHaveBeenCalledWith({
      data: { postId: 10, userId: 6 },
    });
    expect(notifications.notifyPostLike).toHaveBeenCalledWith({
      actorId: 6,
      recipientId: 4,
      postId: 10,
      postTitle: 'Post 10',
    });
    expect(prisma.postLike.deleteMany).toHaveBeenCalledWith({ where: { postId: 10, userId: 6 } });
  });

  it('does not send another notification when a like already exists', async () => {
    const { service, prisma, notifications } = createService();
    prisma.post.findUnique.mockResolvedValue({ id: 10, authorId: 4, content: 'Post 10' });
    prisma.postLike.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.likePost(10, 6)).resolves.toEqual({
      message: 'Post liked successfully',
    });
    expect(notifications.notifyPostLike).not.toHaveBeenCalled();
  });

  it('only lets the author or admin delete a post and cleans up its image', async () => {
    const { service, prisma, storage } = createService();
    prisma.post.findUnique.mockResolvedValue({
      authorId: 4,
      imagePublicId: 'images/posts/550e8400-e29b-41d4-a716-446655440000.webp',
    });

    await expect(service.deletePost(10, 6, Role.USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await service.deletePost(10, 4, Role.USER);
    expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    expect(storage.deleteImage).toHaveBeenCalledWith(
      'images/posts/550e8400-e29b-41d4-a716-446655440000.webp',
    );
  });

  it('rejects comments for a missing post', async () => {
    const { service, prisma } = createService();
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(service.createComment(404, 6, { content: 'Hello' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a comment author edit their comment and trims the content', async () => {
    const { service, prisma } = createService();
    prisma.postComment.findUnique.mockResolvedValue({ postId: 10, authorId: 6 });
    prisma.postComment.update.mockResolvedValue({ id: 4, postId: 10, authorId: 6, content: 'Updated', _count: { replies: 0 } });

    const result = await service.updateComment(10, 4, 6, { content: '  Updated  ' });

    expect(prisma.postComment.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { content: 'Updated' },
      include: {
        author: { select: { id: true, name: true, avatar: true, headline: true } },
        _count: { select: { replies: true } },
      },
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

  it('lists only root comments and exposes reply counts without leaking Prisma counts', async () => {
    const { service, prisma } = createService();
    prisma.post.findUnique.mockResolvedValue({ id: 10, authorId: 4, content: 'Post' });
    prisma.postComment.findMany.mockResolvedValue([
      { id: 7, postId: 10, parentId: null, content: 'Root', _count: { replies: 2 } },
      { id: 6, postId: 10, parentId: null, content: 'Older', _count: { replies: 0 } },
    ]);

    const result = await service.getComments(10, { limit: 1, cursor: 9 });

    expect(prisma.postComment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { postId: 10, parentId: null, id: { lt: 9 } },
      take: 2,
      include: expect.objectContaining({ _count: { select: { replies: true } } }),
    }));
    expect(result.content.data).toEqual([
      { id: 7, postId: 10, parentId: null, content: 'Root', replyCount: 2 },
    ]);
    expect(result.content.nextCursor).toBe(7);
  });

  it('only previews root comments in the feed and retains the total discussion count', async () => {
    const { service, prisma } = createService();
    prisma.post.findMany.mockResolvedValue([{
      id: 10, content: 'Post', imageUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
      author: { id: 6, name: 'Author', avatar: null, headline: null },
      likes: [], savedBy: [],
      comments: [{ id: 4, content: 'Root', parentId: null, _count: { replies: 2 } }],
      _count: { likes: 0, comments: 3 },
    }]);

    const result = await service.getFeed(6, { limit: 1 });

    expect(prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        comments: expect.objectContaining({ where: { parentId: null } }),
      }),
    }));
    expect(result.content.data[0].commentCount).toBe(3);
    expect(result.content.data[0].recentComments[0]).toMatchObject({ id: 4, replyCount: 2 });
    expect(result.content.data[0].recentComments[0]).not.toHaveProperty('_count');
  });

  describe('replies', () => {
    const setup = () => {
      const context = createService();
      context.prisma.post.findUnique.mockResolvedValue({ id: 10, authorId: 4, content: 'Post' });
      context.prisma.postComment.findUnique.mockResolvedValue({
        id: 3, postId: 10, parentId: null, authorId: 7,
      });
      context.prisma.postComment.create.mockResolvedValue({
        id: 8, postId: 10, parentId: 3, authorId: 6,
        content: 'Thanks', _count: { replies: 0 },
      });
      return context;
    };

    it('preserves root comment creation and its post-owner notification', async () => {
      const { service, prisma, notifications } = setup();
      prisma.postComment.create.mockResolvedValue({
        id: 3, postId: 10, parentId: null, content: 'Root', _count: { replies: 0 },
      });
      const result = await service.createComment(10, 6, { content: '  Root  ' });
      expect(result.content).toMatchObject({ parentId: null, replyCount: 0 });
      expect(notifications.notifyPostComment).toHaveBeenCalledWith({
        actorId: 6, recipientId: 4, postId: 10, commentId: 3,
        preview: 'Root', postTitle: 'Post',
      });
    });

    it('stores a reply under its parent and notifies the parent author', async () => {
      const { service, prisma, notifications } = setup();

      const result = await service.createReply(10, 3, 6, { content: '  Thanks  ' });

      expect(prisma.postComment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: { postId: 10, parentId: 3, authorId: 6, content: 'Thanks' },
      }));
      expect(result.content).toMatchObject({ id: 8, parentId: 3, replyCount: 0 });
      expect(result.content).not.toHaveProperty('_count');
      expect(notifications.notifyPostComment).toHaveBeenCalledTimes(1);
      expect(notifications.notifyPostComment).toHaveBeenCalledWith({
        actorId: 6, recipientId: 7, postId: 10, commentId: 8,
        parentCommentId: 3, preview: 'Thanks', postTitle: 'Post',
      });
    });

    it.each([null, { id: 3, postId: 99, parentId: null, authorId: 7 }])(
      'rejects a missing parent or a parent on another post', async (parent) => {
        const { service, prisma, notifications } = setup();
        prisma.postComment.findUnique.mockResolvedValue(parent);

        await expect(service.createReply(10, 3, 6, { content: 'Thanks' }))
          .rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.postComment.create).not.toHaveBeenCalled();
        expect(notifications.notifyPostComment).not.toHaveBeenCalled();
      },
    );

    it('rejects replying to a reply instead of a root comment', async () => {
      const { service, prisma } = setup();
      prisma.postComment.findUnique.mockResolvedValue({ id: 8, postId: 10, parentId: 3, authorId: 7 });

      await expect(service.createReply(10, 8, 6, { content: 'Nested' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.postComment.create).not.toHaveBeenCalled();
    });

    it('rejects empty reply content even when called without HTTP validation', async () => {
      const { service, prisma } = setup();
      await expect(service.createReply(10, 3, 6, { content: '   ' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.postComment.create).not.toHaveBeenCalled();
    });

    it('rejects a reply when its post no longer exists', async () => {
      const { service, prisma } = setup();
      prisma.post.findUnique.mockResolvedValue(null);
      await expect(service.createReply(10, 3, 6, { content: 'Thanks' }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.postComment.create).not.toHaveBeenCalled();
    });

    it('does not hide unrelated database errors', async () => {
      const { service, prisma, notifications } = setup();
      const error = new Error('Database unavailable');
      prisma.postComment.create.mockRejectedValue(error);
      await expect(service.createReply(10, 3, 6, { content: 'Thanks' }))
        .rejects.toBe(error);
      expect(notifications.notifyPostComment).not.toHaveBeenCalled();
    });

    it('maps concurrent parent deletion to not found without sending a notification', async () => {
      const { service, prisma, notifications } = setup();
      prisma.postComment.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed', { code: 'P2003', clientVersion: 'test' },
      ));

      await expect(service.createReply(10, 3, 6, { content: 'Thanks' }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(notifications.notifyPostComment).not.toHaveBeenCalled();
    });

    it('returns only the requested thread with a stable next cursor', async () => {
      const { service, prisma } = setup();
      prisma.postComment.findMany.mockResolvedValue([
        { id: 8, parentId: 3, content: 'Newest', _count: { replies: 0 } },
        { id: 7, parentId: 3, content: 'Older', _count: { replies: 0 } },
      ]);

      const result = await service.getReplies(10, 3, { limit: 1, cursor: 9 });

      expect(prisma.postComment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { postId: 10, parentId: 3, id: { lt: 9 } },
        orderBy: { id: 'desc' }, take: 2,
      }));
      expect(result.content).toEqual({
        data: [{ id: 8, parentId: 3, content: 'Newest', replyCount: 0 }], nextCursor: 8,
      });
    });

    it('returns an empty thread without a cursor', async () => {
      const { service, prisma } = setup();
      prisma.postComment.findMany.mockResolvedValue([]);
      expect((await service.getReplies(10, 3, { limit: 10 })).content)
        .toEqual({ data: [], nextCursor: null });
    });

    it('does not list replies from a parent on another post', async () => {
      const { service, prisma } = setup();
      prisma.postComment.findUnique.mockResolvedValue({ id: 3, postId: 99, parentId: null });
      await expect(service.getReplies(10, 3, { limit: 10 }))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.postComment.findMany).not.toHaveBeenCalled();
    });

    it('does not let another user delete a reply', async () => {
      const { service, prisma } = setup();
      prisma.postComment.findUnique.mockResolvedValue({ id: 8, postId: 10, parentId: 3, authorId: 7 });
      await expect(service.deleteComment(10, 8, 6, Role.USER))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.postComment.delete).not.toHaveBeenCalled();
    });

    it('lets the author edit a reply without changing its parent', async () => {
      const { service, prisma } = setup();
      prisma.postComment.findUnique.mockResolvedValue({ postId: 10, authorId: 6 });
      prisma.postComment.update.mockResolvedValue({
        id: 8, postId: 10, parentId: 3, content: 'Edited', _count: { replies: 0 },
      });
      const result = await service.updateComment(10, 8, 6, { content: '  Edited  ' });
      expect(prisma.postComment.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 8 }, data: { content: 'Edited' },
      }));
      expect(result.content).toMatchObject({ id: 8, parentId: 3, content: 'Edited' });
    });

    it('does not let another user edit a reply', async () => {
      const { service, prisma } = setup();
      prisma.postComment.findUnique.mockResolvedValue({ postId: 10, authorId: 7 });
      await expect(service.updateComment(10, 8, 6, { content: 'Edited' }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.postComment.update).not.toHaveBeenCalled();
    });

    it.each(['edit', 'delete'])('rejects a cross-post reply %s', async (action) => {
      const { service, prisma } = setup();
      prisma.postComment.findUnique.mockResolvedValue({ postId: 99, authorId: 6 });
      const operation = action === 'edit'
        ? service.updateComment(10, 8, 6, { content: 'Edited' })
        : service.deleteComment(10, 8, 6, Role.USER);
      await expect(operation).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.postComment.update).not.toHaveBeenCalled();
      expect(prisma.postComment.delete).not.toHaveBeenCalled();
    });

    it.each([Role.USER, Role.ADMIN])('allows the reply author or an admin to delete using the existing endpoint: %s', async (role) => {
      const { service, prisma } = setup();
      prisma.postComment.findUnique.mockResolvedValue({ id: 8, postId: 10, parentId: 3, authorId: 6 });
      await service.deleteComment(10, 8, role === Role.ADMIN ? 99 : 6, role);
      expect(prisma.postComment.delete).toHaveBeenCalledWith({ where: { id: 8 } });
    });
  });
});
