import { AdminService } from './admin.service';

describe('AdminService', () => {
  it('returns aggregate dashboard counts without loading resource rows', async () => {
    const prisma = {
      user: { count: jest.fn().mockResolvedValue(12) },
      job: { count: jest.fn().mockResolvedValue(34) },
      contract: { count: jest.fn().mockResolvedValue(5) },
      comment: { count: jest.fn().mockResolvedValue(67) },
    };
    const service = new AdminService(prisma as never);

    await expect(service.getStats()).resolves.toEqual({
      message: 'Admin statistics fetched successfully',
      content: { users: 12, jobs: 34, contracts: 5, comments: 67 },
    });
    expect(prisma.user.count).toHaveBeenCalledTimes(1);
    expect(prisma.job.count).toHaveBeenCalledTimes(1);
    expect(prisma.contract.count).toHaveBeenCalledTimes(1);
    expect(prisma.comment.count).toHaveBeenCalledTimes(1);
  });
});
