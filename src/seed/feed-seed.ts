type SeedUser = { id: number };
type SeedPost = { id: number; authorId: number };

export type FeedSeedClient = {
  user: {
    findMany(args: {
      orderBy: { id: 'asc' };
      take: number;
      select: { id: true };
    }): Promise<SeedUser[]>;
  };
  post: {
    findFirst(args: {
      where: { authorId: number; content: string };
      select: { id: true; authorId: true };
    }): Promise<SeedPost | null>;
    create(args: {
      data: { authorId: number; content: string; imageUrl?: string };
      select: { id: true; authorId: true };
    }): Promise<SeedPost>;
  };
  postComment: {
    findFirst(args: {
      where: { postId: number; authorId: number; content: string };
      select: { id: true };
    }): Promise<{ id: number } | null>;
    create(args: {
      data: { postId: number; authorId: number; content: string };
      select: { id: true };
    }): Promise<{ id: number }>;
  };
  postLike: {
    upsert(args: {
      where: { postId_userId: { postId: number; userId: number } };
      create: { postId: number; userId: number };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
  job: {
    findMany(args: {
      orderBy: { id: 'asc' };
      take: number;
      select: { id: true };
    }): Promise<Array<{ id: number }>>;
  };
  connection: {
    upsert(args: {
      where: { pairKey: string };
      create: {
        pairKey: string;
        requesterId: number;
        recipientId: number;
        status?: 'PENDING' | 'ACCEPTED';
      };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
  savedPost: {
    upsert(args: {
      where: { userId_postId: { userId: number; postId: number } };
      create: { userId: number; postId: number };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
  savedJob: {
    upsert(args: {
      where: { userId_jobId: { userId: number; jobId: number } };
      create: { userId: number; jobId: number };
      update: Record<string, never>;
    }): Promise<unknown>;
  };
};

export const FEED_POSTS = [
  {
    authorOffset: 0,
    content:
      'Just shipped a cleaner dashboard flow for a client project. The biggest improvement came from removing two unnecessary steps, not adding more UI.',
    imageUrl:
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1400&q=85',
  },
  {
    authorOffset: 1,
    content:
      'Looking for feedback from backend developers: what makes API documentation genuinely useful during handoff? Examples, error cases, and realistic payloads are my current top three.',
  },
  {
    authorOffset: 2,
    content:
      'Three lessons from this week: clarify the outcome before choosing tools, show work early, and leave enough time for the final ten percent of polish.',
    imageUrl:
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=85',
  },
  {
    authorOffset: 3,
    content:
      'I have availability for one new project this month. Best fit: product teams that need a focused design or development sprint with clear weekly deliverables.',
  },
  {
    authorOffset: 4,
    content:
      'Portfolio update: documenting the decisions behind the work made the case study much stronger than showing final screens alone.',
    imageUrl:
      'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?auto=format&fit=crop&w=1400&q=85',
  },
  {
    authorOffset: 5,
    content:
      'Small career win today: a past client returned with a larger project after the first collaboration went well. Reliable communication compounds.',
    imageUrl:
      'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1400&q=85',
  },
] as const;

const FEED_COMMENTS = [
  { postIndex: 0, authorOffset: 1, content: 'Reducing steps is usually the hardest and most valuable design work.' },
  { postIndex: 0, authorOffset: 2, content: 'The dashboard looks clear. Strong hierarchy.' },
  { postIndex: 1, authorOffset: 1, content: 'Real error responses save a lot of integration time.' },
  { postIndex: 2, authorOffset: 1, content: 'Showing work early has improved every project I have tried it on.' },
  { postIndex: 3, authorOffset: 2, content: 'Clear weekly deliverables make collaboration much easier.' },
  { postIndex: 4, authorOffset: 1, content: 'Decision context is what makes a case study credible.' },
  { postIndex: 5, authorOffset: 2, content: 'Repeat work is a strong signal. Congratulations.' },
] as const;

const FEED_LIKES = [
  { postIndex: 0, userOffset: 1 },
  { postIndex: 0, userOffset: 2 },
  { postIndex: 0, userOffset: 3 },
  { postIndex: 1, userOffset: 2 },
  { postIndex: 2, userOffset: 0 },
  { postIndex: 2, userOffset: 3 },
  { postIndex: 3, userOffset: 1 },
  { postIndex: 4, userOffset: 2 },
  { postIndex: 5, userOffset: 0 },
  { postIndex: 5, userOffset: 1 },
] as const;

export async function seedFeed(prisma: FeedSeedClient) {
  const users = await prisma.user.findMany({
    orderBy: { id: 'asc' },
    take: 6,
    select: { id: true },
  });
  if (!users.length) {
    throw new Error('Feed seed requires at least one existing user');
  }

  const posts: SeedPost[] = [];
  let postsCreated = 0;
  let postsExisting = 0;
  for (const definition of FEED_POSTS) {
    const authorId = users[definition.authorOffset % users.length].id;
    const existing = await prisma.post.findFirst({
      where: { authorId, content: definition.content },
      select: { id: true, authorId: true },
    });
    if (existing) {
      posts.push(existing);
      postsExisting += 1;
      continue;
    }
    posts.push(
      await prisma.post.create({
        data: {
          authorId,
          content: definition.content,
          ...('imageUrl' in definition
            ? { imageUrl: definition.imageUrl }
            : {}),
        },
        select: { id: true, authorId: true },
      }),
    );
    postsCreated += 1;
  }

  let commentsCreated = 0;
  let commentsExisting = 0;
  for (const definition of FEED_COMMENTS) {
    const post = posts[definition.postIndex];
    const authorId =
      users[(definition.postIndex + definition.authorOffset) % users.length].id;
    const existing = await prisma.postComment.findFirst({
      where: { postId: post.id, authorId, content: definition.content },
      select: { id: true },
    });
    if (existing) {
      commentsExisting += 1;
      continue;
    }
    await prisma.postComment.create({
      data: { postId: post.id, authorId, content: definition.content },
      select: { id: true },
    });
    commentsCreated += 1;
  }

  for (const definition of FEED_LIKES) {
    const postId = posts[definition.postIndex].id;
    const userId = users[definition.userOffset % users.length].id;
    await prisma.postLike.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {},
    });
  }

  let connectionsUpserted = 0;
  if (users.length >= 2) {
    const requesterId = users[0].id;
    const recipientId = users[1].id;
    const pairKey = [requesterId, recipientId].sort((a, b) => a - b).join(':');
    await prisma.connection.upsert({
      where: { pairKey },
      create: {
        pairKey,
        requesterId,
        recipientId,
        status: 'ACCEPTED',
      },
      update: {},
    });
    connectionsUpserted += 1;
  }
  if (users.length >= 3) {
    const requesterId = users[2].id;
    const recipientId = users[0].id;
    const pairKey = [requesterId, recipientId].sort((a, b) => a - b).join(':');
    await prisma.connection.upsert({
      where: { pairKey },
      create: { pairKey, requesterId, recipientId, status: 'PENDING' },
      update: {},
    });
    connectionsUpserted += 1;
  }

  if (users.length >= 2 && posts.length) {
    const userId = users[1].id;
    const postId = posts[0].id;
    await prisma.savedPost.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId },
      update: {},
    });
  }

  const jobs = await prisma.job.findMany({
    orderBy: { id: 'asc' },
    take: 1,
    select: { id: true },
  });
  if (jobs.length) {
    const userId = users[0].id;
    const jobId = jobs[0].id;
    await prisma.savedJob.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId },
      update: {},
    });
  }

  return {
    postsCreated,
    postsExisting,
    commentsCreated,
    commentsExisting,
    likesUpserted: FEED_LIKES.length,
    connectionsUpserted,
    savedPostsUpserted: users.length >= 2 && posts.length ? 1 : 0,
    savedJobsUpserted: jobs.length ? 1 : 0,
  };
}
