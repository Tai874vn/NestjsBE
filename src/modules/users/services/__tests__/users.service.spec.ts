import { ConflictException } from '@nestjs/common';
import { UsersService } from '../users.service';

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

  it('reads account details directly from PostgreSQL without caching PII in Redis', async () => {
    const { service, prisma, redisService } = createService();
    const dbUser = {
      id: 1,
      name: 'Direct User',
      email: 'direct@example.com',
    };

    prisma.user.findUnique.mockResolvedValue(dbUser);

    await expect(service.findOne(1)).resolves.toEqual({
      message: 'Get user successfully',
      content: dbUser,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } }),
    );
    expect(redisService.get).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('deletes an account through the revoking session transaction, not a direct cascade', async () => {
    const { service, prisma, sessions } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 7 });
    await service.remove(7);
    expect(sessions.deleteUser).toHaveBeenCalledWith(7);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('deletes local files for cascaded posts, jobs, portfolio items, avatar, cover and resume after user deletion (Finding 12)', async () => {
    const { prisma, redisService, sessions } = createService();
    const storage = {
      deleteImage: jest.fn().mockResolvedValue(undefined),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
    };
    const service = new UsersService(
      prisma as any,
      redisService as any,
      sessions as any,
      {} as any,
      storage as any,
    );
    prisma.user.findUnique.mockResolvedValue({
      id: 7,
      avatar: '/uploads/images/avatars/550e8400-e29b-41d4-a716-446655440001.webp',
      coverImage: '/uploads/images/covers/550e8400-e29b-41d4-a716-446655440002.webp',
      resume: {
        sourceFilePublicId: 'documents/resumes/550e8400-e29b-41d4-a716-446655440003.pdf',
        sourceFileUrl: null,
      },
      posts: [
        {
          imagePublicId: 'images/posts/550e8400-e29b-41d4-a716-446655440004.webp',
          imageUrl: '/uploads/images/posts/550e8400-e29b-41d4-a716-446655440004.webp',
        },
      ],
      jobs: [
        {
          image: '/uploads/images/jobs/550e8400-e29b-41d4-a716-446655440005.webp',
        },
      ],
      portfolioItems: [
        {
          image: '/uploads/images/portfolio/550e8400-e29b-41d4-a716-446655440006.webp',
        },
      ],
    });

    await service.remove(7);

    expect(sessions.deleteUser).toHaveBeenCalledWith(7);
    expect(storage.deleteImage).toHaveBeenCalledWith(
      '/uploads/images/avatars/550e8400-e29b-41d4-a716-446655440001.webp',
    );
    expect(storage.deleteImage).toHaveBeenCalledWith(
      '/uploads/images/covers/550e8400-e29b-41d4-a716-446655440002.webp',
    );
    expect(storage.deleteDocument).toHaveBeenCalledWith(
      'documents/resumes/550e8400-e29b-41d4-a716-446655440003.pdf',
    );
    expect(storage.deleteImage).toHaveBeenCalledWith(
      'images/posts/550e8400-e29b-41d4-a716-446655440004.webp',
    );
    expect(storage.deleteImage).toHaveBeenCalledWith(
      '/uploads/images/jobs/550e8400-e29b-41d4-a716-446655440005.webp',
    );
    expect(storage.deleteImage).toHaveBeenCalledWith(
      '/uploads/images/portfolio/550e8400-e29b-41d4-a716-446655440006.webp',
    );
  });
});
