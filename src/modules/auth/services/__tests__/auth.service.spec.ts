import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { Role } from '../../../../common/constants/roles';

describe('AuthService current user profile', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const sessions = { create: jest.fn().mockResolvedValue({ token: 'jwt-token', refreshToken: 'opaque-refresh', logoutToken: 'logout-credential' }) };
    const emailVerification = { sendFirst: jest.fn().mockResolvedValue(true) };
    const service = new AuthService(
      prisma as any,
      sessions as any,
      emailVerification as any,
    );

    return { service, prisma, sessions, emailVerification };
  };

  it('enables candidate discoverability for new accounts by default', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 12,
      email: 'candidate@example.com',
      role: Role.USER,
    });

    await service.signUp({
      name: 'Candidate',
      email: 'candidate@example.com',
      password: 'password123',
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: Role.USER,
        candidateDiscoverable: true,
      }),
    });
  });

  it('creates employer accounts when signup role is employer', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
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

  it('rejects duplicate email signup without changing the existing account role', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: 11,
      name: 'Existing Employer',
      email: 'Hiring@Example.com',
      role: Role.EMPLOYER,
    });

    await expect(
      service.signUp({
        name: 'Existing Employer',
        email: 'hiring@example.com',
        password: 'password123',
        role: Role.USER,
      }),
    ).rejects.toThrow('Email already exists');

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
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

  it('sign-up mails the confirm link and does not create a session', async () => {
    const { service, prisma, sessions, emailVerification } = createService();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 20,
      name: 'New',
      email: 'new@example.com',
      password: 'hashed',
      refreshToken: null,
      role: Role.USER,
    });

    const result = await service.signUp({
      name: 'New',
      email: 'New@Example.com',
      password: 'password123',
    });

    expect(emailVerification.sendFirst).toHaveBeenCalledWith(
      expect.objectContaining({ id: 20, email: 'new@example.com' }),
    );
    expect(sessions.create).not.toHaveBeenCalled();
    expect(result.content).toMatchObject({
      verificationRequired: true,
      mailSent: true,
    });
    expect(result.content?.user).not.toHaveProperty('password');
  });

  it('sign-in refuses an unconfirmed address only after the password is right', async () => {
    const hash = await bcrypt.hash('password123', 4);
    const { service, prisma, sessions } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: 21,
      email: 'u@example.com',
      password: hash,
      bannedAt: null,
      emailVerifiedAt: null,
    });

    await expect(
      service.signIn({ email: 'u@example.com', password: 'wrong-password' }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.signIn({ email: 'u@example.com', password: 'password123' }),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('sign-in works for a confirmed address', async () => {
    const hash = await bcrypt.hash('password123', 4);
    const { service, prisma, sessions } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: 22,
      email: 'ok@example.com',
      password: hash,
      bannedAt: null,
      emailVerifiedAt: new Date('2026-01-01'),
    });

    await service.signIn({ email: 'ok@example.com', password: 'password123' });
    expect(sessions.create).toHaveBeenCalledWith(22, {}, hash);
  });
});
