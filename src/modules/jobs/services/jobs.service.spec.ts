import { JobsService } from './jobs.service';

describe('JobsService bounded queries', () => {
  it('returns one database page for a creator', async () => {
    const prisma = {
      job: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new JobsService(prisma as never, {} as never);

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
});
