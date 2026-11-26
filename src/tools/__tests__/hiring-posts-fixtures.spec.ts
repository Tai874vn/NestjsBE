import { HiringPostStatus, Prisma } from '@prisma/client';
import { seedHiringPosts } from '../hiring-posts-fixtures';

type FixturePost = Prisma.HiringPostUncheckedCreateInput & { id: number };

function createClient() {
  const employers = [
    { id: 10, role: 'employer', email: 'one@jobaura.test' },
    { id: 20, role: 'employer', email: 'two@jobaura.test' },
    { id: 30, role: 'employer', email: 'real@example.com' },
    { id: 40, role: 'user', email: 'candidate@jobaura.test' },
  ];
  const posts: FixturePost[] = [];
  const client = {
    user: {
      findMany: jest.fn(
        ({ where }: Prisma.UserFindManyArgs) =>
          Promise.resolve(
            employers.filter(
              (user) =>
                user.role === where?.role &&
                typeof where?.email === 'object' &&
                typeof where.email.endsWith === 'string' &&
                user.email.endsWith(where.email.endsWith),
            ),
          ),
      ),
    },
    hiringPost: {
      findFirst: jest.fn(({ where }: Prisma.HiringPostFindFirstArgs) =>
        Promise.resolve(
          posts.find(
            (post) =>
              post.recruiterId === where?.recruiterId &&
              post.title === where?.title,
          ) ?? null,
        ),
      ),
      create: jest.fn(
        ({ data }: { data: Prisma.HiringPostUncheckedCreateInput }) => {
          const post = { ...data, id: posts.length + 1 };
          posts.push(post);
          return Promise.resolve(post);
        },
      ),
    },
  };

  return {
    client: client as unknown as Pick<
      Prisma.TransactionClient,
      'user' | 'hiringPost'
    >,
    employers,
    posts,
  };
}

describe('seedHiringPosts', () => {
  it('creates 20 open vacancies owned only by existing demo employers', async () => {
    const { client, posts } = createClient();

    await expect(seedHiringPosts(client)).resolves.toEqual({
      created: 20,
      existing: 0,
    });

    expect(posts).toHaveLength(20);
    expect(new Set(posts.map((post) => post.recruiterId))).toEqual(
      new Set([10, 20]),
    );
    for (const post of posts) {
      expect(post.status).toBe(HiringPostStatus.OPEN);
      expect(post.description).toContain('Demo vacancy');
      expect(post.requirements?.length).toBeGreaterThan(20);
      expect(post.salaryMin).toBeGreaterThan(0);
      expect(post.salaryMax).toBeGreaterThanOrEqual(post.salaryMin as number);
    }
  });

  it('does not duplicate or overwrite posts when rerun', async () => {
    const { client, posts } = createClient();
    await seedHiringPosts(client);
    expect(posts).toHaveLength(20);
    posts[0].description = 'An employer edited this description.';
    posts[0].status = HiringPostStatus.CLOSED;
    const before = structuredClone(posts);

    await expect(seedHiringPosts(client)).resolves.toEqual({
      created: 0,
      existing: 20,
    });
    expect(posts).toEqual(before);
  });

  it('fails before writing if no demo employers exist', async () => {
    const { client, employers, posts } = createClient();
    employers.splice(0, 2);

    await expect(seedHiringPosts(client)).rejects.toThrow(
      'Hiring seed requires an existing employer with an @jobaura.test email',
    );
    expect(posts).toEqual([]);
  });
});
