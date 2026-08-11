import { FEED_POSTS, seedFeed } from './feed-seed';

describe('seedFeed', () => {
  it('adds missing feed data without duplicating existing seeded posts', async () => {
    const users = [{ id: 10 }, { id: 20 }, { id: 30 }];
    const existingPost = { id: 100, authorId: users[0].id };
    let nextPostId = 101;
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue(users),
      },
      post: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existingPost)
          .mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: nextPostId++, authorId: data.authorId }),
        ),
      },
      postComment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      postLike: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([{ id: 50 }]),
      },
      connection: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      savedPost: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      savedJob: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const result = await seedFeed(prisma as never);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' }, take: 6 }),
    );
    expect(prisma.post.create).toHaveBeenCalledTimes(FEED_POSTS.length - 1);
    expect(prisma.postLike.upsert).toHaveBeenCalled();
    expect(prisma.connection.upsert).toHaveBeenCalled();
    expect(prisma.savedPost.upsert).toHaveBeenCalled();
    expect(prisma.savedJob.upsert).toHaveBeenCalled();
    expect(result).toMatchObject({
      postsCreated: FEED_POSTS.length - 1,
      postsExisting: 1,
    });
  });

  it('fails clearly when there are no existing users to author posts', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await expect(seedFeed(prisma as never)).rejects.toThrow(
      'Feed seed requires at least one existing user',
    );
  });
});
