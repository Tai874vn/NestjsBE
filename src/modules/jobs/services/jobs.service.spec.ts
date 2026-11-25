import { Prisma } from '@prisma/client';
import { JobsService } from './jobs.service';
import { JobCacheInvalidationService } from './job-cache-invalidation.service';
import { JobCatalogService } from './job-catalog.service';
import { ConflictException } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { NotificationTemplateService } from '../../notifications/services/notification-template.service';
import {
  JobMutationService,
  SERVICE_HAS_CONTRACTS,
} from './job-mutation.service';
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

  it('caches only unfiltered pages 1-5 with the default sort, and never caches free-text search', async () => {
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

    // Unfiltered pages 1 and 5 with default sort are cached.
    await service.findAllWithPagination({ page: 1, pageSize: 12 });
    await service.findAllWithPagination({ page: 5, pageSize: 12 });
    expect(redis.getOrSet).toHaveBeenCalledTimes(2);

    redis.getOrSet.mockClear();

    // Deep page, filters, custom sort, cursor with token, and free-text search bypass Redis.
    await service.findAllWithPagination({ page: 6, pageSize: 12 });
    await service.findAllWithPagination({ page: 1, keyword: 'logo' });
    await service.findAllWithPagination({ page: 1, categoryId: 2 });
    await service.findAllWithPagination({ page: 1, subcategoryId: 5 });
    await service.findAllWithPagination({ page: 1, minPrice: 100 });
    await service.findAllWithPagination({ page: 1, maxPrice: 500 });
    await service.findAllWithPagination({ page: 1, minRating: 4 });
    await service.findAllWithPagination({ page: 1, sort: 'price_asc' });
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-06-25T08:00:00.000Z', id: 12 }),
    ).toString('base64url');
    await service.findAllWithCursor({ limit: 10, cursor });
    await service.findAllWithCursor({ limit: 10, keyword: 'react' });
    await service.searchByName('logo design');

    expect(redis.getOrSet).not.toHaveBeenCalled();
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

describe('JobMutationService.remove (service delete)', () => {
  function setup(contracts: number, open: Array<{ id: number; clientId: number; freelancerId: number }> = []) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ title: 'Bakery logo' }]),
      contract: { count: jest.fn().mockResolvedValue(contracts) },
      proposal: { findMany: jest.fn().mockResolvedValue(open) },
      job: { delete: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      job: { findUnique: jest.fn().mockResolvedValue({ creatorId: 9, workMode: 'REMOTE', serviceArea: null }) },
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const templates = new NotificationTemplateService();
    const mutations = new JobMutationService(
      prisma as any,
      { invalidateJobMutation: jest.fn() } as any,
      notifications as any,
      templates,
    );
    return { tx, prisma, notifications, mutations };
  }

  it('refuses (409) a service that has any contract, and deletes nothing', async () => {
    const { tx, mutations } = setup(1);
    await expect(mutations.remove(4, 9, Role.USER)).rejects.toThrow(
      new ConflictException(SERVICE_HAS_CONTRACTS),
    );
    expect(tx.contract.count).toHaveBeenCalledWith({ where: { jobId: 4 } });
    expect(tx.job.delete).not.toHaveBeenCalled();
  });

  it('a delete the database refuses (P2003, a contract made meanwhile) is also 409', async () => {
    const { tx, mutations } = setup(0);
    tx.job.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }),
    );
    await expect(mutations.remove(4, 9, Role.USER)).rejects.toThrow(
      new ConflictException(SERVICE_HAS_CONTRACTS),
    );
  });

  it('OPEN proposals do not block: the service is deleted and the client of each one is told', async () => {
    const { tx, notifications, mutations } = setup(0, [{ id: 70, clientId: 3, freelancerId: 9 }]);

    const result = await mutations.remove(4, 9, Role.USER);

    expect(result.message).toBe('Job deleted successfully');
    expect(tx.proposal.findMany).toHaveBeenCalledWith({
      where: { jobId: 4, status: 'OPEN' },
      select: { id: true, clientId: true, freelancerId: true },
    });
    expect(tx.job.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    // Only the other person (the client) is told; the owner who deleted is not.
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 3,
        type: 'PROPOSAL_UPDATE',
        title: 'Proposal withdrawn',
        body: 'The service Bakery logo was deleted, so the open proposal for it was withdrawn.',
        actionUrl: '/contracts?tab=client',
      }),
    );
  });

  it('deletes the old job image on replace and when the service is removed', async () => {
    const oldImage =
      '/uploads/images/jobs/550e8400-e29b-41d4-a716-446655440000.webp';
    const newImage =
      '/uploads/images/jobs/11111111-1111-4111-8111-111111111111.webp';
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ title: 'Bakery logo' }]),
      contract: { count: jest.fn().mockResolvedValue(0) },
      proposal: { findMany: jest.fn().mockResolvedValue([]) },
      job: { delete: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      job: {
        findUnique: jest.fn().mockResolvedValue({
          creatorId: 9,
          workMode: 'REMOTE',
          serviceArea: null,
          image: oldImage,
        }),
        update: jest.fn().mockResolvedValue({ id: 4, image: newImage }),
      },
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const storage = { deleteImage: jest.fn().mockResolvedValue(undefined) };
    const mutations = new JobMutationService(
      prisma as any,
      { invalidateJobMutation: jest.fn() } as any,
      undefined,
      undefined,
      storage as any,
    );

    await mutations.uploadImage(4, newImage, 9, Role.USER);
    expect(storage.deleteImage).toHaveBeenCalledWith(oldImage);

    storage.deleteImage.mockClear();
    await mutations.remove(4, 9, Role.USER);
    expect(storage.deleteImage).toHaveBeenCalledWith(oldImage);
  });
});
