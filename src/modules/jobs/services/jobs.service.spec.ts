import { JobsService } from './jobs.service';
import { JobCacheInvalidationService } from './job-cache-invalidation.service';
import { JobCatalogService } from './job-catalog.service';
import { JobMutationService } from './job-mutation.service';
import { JobSearchService } from './job-search.service';

describe('JobsService bounded queries', () => {
  function createService(prisma: any, redis: any = {}) {
    const cacheInvalidation = new JobCacheInvalidationService(redis);
    return new JobsService(
      new JobMutationService(prisma, cacheInvalidation),
      new JobSearchService(prisma, redis),
      new JobCatalogService(prisma, redis),
    );
  }

  it('returns one database page for a creator', async () => {
    const prisma = {
      job: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = createService(prisma);

    const result = await service.findByCreator(8, { page: 2, pageSize: 20 });

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { creatorId: 8 },
        skip: 20,
        take: 20,
      }),
    );
    expect(prisma.job.count).toHaveBeenCalledWith({
      where: { creatorId: 8 },
    });
    expect(result.content.total).toBe(0);
  });

  it('includes seller profile fields in paginated marketplace jobs', async () => {
    const prisma = {
      job: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const redis = {
      getOrSet: jest.fn((_key, loader) => loader()),
    };
    const service = createService(prisma, redis);

    await service.findAllWithPagination({ page: 1, pageSize: 12 });

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          user: { select: { id: true, name: true, avatar: true } },
        }),
      }),
    );
  });

  it('returns cursor pages with one extra row to determine nextCursor', async () => {
    const rows = [
      { id: 12, createdAt: new Date('2026-06-25T08:00:00.000Z') },
      { id: 11, createdAt: new Date('2026-06-25T07:00:00.000Z') },
      { id: 10, createdAt: new Date('2026-06-25T06:00:00.000Z') },
    ];
    const prisma = {
      job: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const redis = {
      getOrSet: jest.fn((_key, loader) => loader()),
    };
    const service = createService(prisma, redis);

    const result = await service.findAllWithCursor({ limit: 2 });

    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result.content.data).toEqual(rows.slice(0, 2));
    expect(result.content.nextCursor).toEqual(expect.any(String));
  });
});
