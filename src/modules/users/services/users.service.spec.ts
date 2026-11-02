import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService account behavior', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const redisService = {
      get: jest.fn(),
      set: jest.fn(),
      invalidateUserCaches: jest.fn(),
    };

    const sessions = { deleteUser: jest.fn() };
    const service = new UsersService(prisma as any, redisService as any, sessions as any);

    return { service, prisma, redisService, sessions };
  };

  it('enables candidate discoverability for admin-created accounts by default', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 2, name: 'Candidate' });

    await service.create({
      name: 'Candidate',
      email: 'candidate@example.com',
      password: 'password123',
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ candidateDiscoverable: true }),
      }),
    );
  });

  it('rejects duplicate account emails on create', async () => {
    const { service, prisma } = createService();

    prisma.user.findFirst.mockResolvedValue({
      id: 1,
      email: 'Jane@Example.com',
    });

    await expect(
      service.create({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'jane@example.com', mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns cached account details without querying the database', async () => {
    const { service, prisma, redisService } = createService();
    const cachedUser = {
      message: 'Get user successfully',
      content: { id: 1, name: 'Cached User' },
    };

    redisService.get.mockResolvedValue(cachedUser);

    await expect(service.findOne(1)).resolves.toBe(cachedUser);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('deletes an account through the revoking session transaction, not a direct cascade', async () => {
    const { service, prisma, sessions } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 7 });
    await service.remove(7);
    expect(sessions.deleteUser).toHaveBeenCalledWith(7);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});
