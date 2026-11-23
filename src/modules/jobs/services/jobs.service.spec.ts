import { Prisma } from '@prisma/client';
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

describe('JobsService service fields', () => {
  const step = (share: number) => ({ title: 'Step', share });
  function setup(existing: any = { creatorId: 1, workMode: 'REMOTE', serviceArea: null }) {
    const prisma = {
      job: {
        create: jest.fn().mockResolvedValue({ id: 9 }),
        update: jest.fn().mockResolvedValue({ id: 9 }),
        findUnique: jest.fn().mockResolvedValue(existing),
      },
    };
    const mutations = new JobMutationService(prisma as any, {
      invalidateJobMutation: jest.fn(),
    } as any);
    return { prisma, mutations };
  }
  const dto = { title: 'Service', subcategoryId: 1 } as any;

  it('saves shares 30/40/30', async () => {
    const { prisma, mutations } = setup();
    const template = [step(30), step(40), step(30)];
    await mutations.create({ ...dto, milestoneTemplate: template }, 1);
    expect(prisma.job.create.mock.calls[0][0].data.milestoneTemplate).toEqual(template);
  });

  it('rejects shares 30/40/20 with 400', async () => {
    const { prisma, mutations } = setup();
    await expect(
      mutations.create({ ...dto, milestoneTemplate: [step(30), step(40), step(20)] }, 1),
    ).rejects.toThrow('Template shares must add up to 100.');
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it('defaults to REMOTE and stores null area for REMOTE', async () => {
    const { prisma, mutations } = setup();
    await mutations.create({ ...dto, serviceArea: 'Hanoi' }, 1);
    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.workMode).toBe('REMOTE');
    expect(data.serviceArea).toBeNull();
  });

  it('keeps the area for ONSITE', async () => {
    const { prisma, mutations } = setup();
    await mutations.create({ ...dto, workMode: 'ONSITE', serviceArea: 'Hanoi' }, 1);
    expect(prisma.job.create.mock.calls[0][0].data.serviceArea).toBe('Hanoi');
  });

  it('update with null template clears it', async () => {
    const { prisma, mutations } = setup();
    await mutations.update(9, { milestoneTemplate: null } as any, 1, 'USER' as any);
    expect(prisma.job.update.mock.calls[0][0].data.milestoneTemplate).toBe(Prisma.JsonNull);
  });

  it('update to REMOTE clears a stored area', async () => {
    const { prisma, mutations } = setup({ creatorId: 1, workMode: 'ONSITE', serviceArea: 'Hanoi' });
    await mutations.update(9, { workMode: 'REMOTE' } as any, 1, 'USER' as any);
    expect(prisma.job.update.mock.calls[0][0].data.serviceArea).toBeNull();
  });

  it('update rejects bad shares', async () => {
    const { mutations } = setup();
    await expect(
      mutations.update(9, { milestoneTemplate: [step(50)] } as any, 1, 'USER' as any),
    ).rejects.toThrow('Template shares must add up to 100.');
  });
});
