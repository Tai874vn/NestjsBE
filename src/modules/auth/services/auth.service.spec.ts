import { AuthService } from './auth.service';
import { Role } from '../../../common/constants/roles';

describe('AuthService current user profile', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const jwtService = {
      sign: jest.fn().mockReturnValue('jwt-token'),
      verify: jest.fn(),
    };

    const service = new AuthService(prisma as any, jwtService as any);

    return { service, prisma };
  };

  it('creates employer accounts when signup role is employer', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 11,
      name: 'Hiring Manager',
      email: 'hiring@example.com',
      password: 'hashed',
      refreshToken: null,
      role: Role.EMPLOYER,
    });
    prisma.user.update.mockResolvedValue({});

    const result = await service.signUp({
      name: 'Hiring Manager',
      email: 'hiring@example.com',
      password: 'password123',
      role: Role.EMPLOYER,
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: Role.EMPLOYER }),
      }),
    );
    expect(result.content?.user).toMatchObject({ role: Role.EMPLOYER });
  });

  it('returns normalized current user profile data without legacy skill strings', async () => {
    const { service, prisma } = createService();

    prisma.user.findUnique.mockResolvedValue({
      id: 6,
      name: 'tai',
      email: 'tai@example.com',
      phone: '0385500613',
      birthDay: '2026-05-24',
      gender: 'Male',
      role: 'user',
      skill: JSON.stringify(['["react"]', 'dsda']),
      certification: JSON.stringify(['AWS']),
      headline: 'Fullstack Dev',
      bio: 'hello',
      location: 'HCM',
      website: 'https://example.com',
      googleId: '101553504140371053623',
      avatar: 'https://example.com/avatar.png',
      coverImage: 'https://example.com/cover.png',
      profileCompleted: true,
      createdAt: new Date('2026-05-18T01:56:34.837Z'),
      updatedAt: new Date('2026-05-23T08:09:05.861Z'),
      profileSkills: [],
      profileCertifications: [],
      portfolioItems: [],
    });

    const result = await service.getCurrentUser(6);

    expect(result.content).not.toHaveProperty('skill');
    expect(result.content).not.toHaveProperty('certification');
    expect(result.content).toMatchObject({
      id: 6,
      email: 'tai@example.com',
      profileSkills: [
        expect.objectContaining({ name: 'react' }),
        expect.objectContaining({ name: 'dsda' }),
      ],
      profileCertifications: [expect.objectContaining({ name: 'AWS' })],
      portfolioItems: [],
    });
  });
});
