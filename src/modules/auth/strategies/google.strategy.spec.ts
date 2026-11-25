import { Role } from '../../../common/constants/roles';
import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  const createStrategy = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
          GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/auth/google/callback',
        };

        return values[key];
      }),
    };

    return {
      prisma,
      strategy: new GoogleStrategy(prisma as any, configService as any),
    };
  };

  const profile = {
    id: 'google-user-id',
    displayName: 'Hiring Manager',
    emails: [{ value: 'hiring@example.com' }],
    photos: [{ value: 'https://example.com/avatar.png' }],
  };

  it('enables candidate discoverability for new Google accounts by default', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValue({ id: 18, role: Role.USER });

    await strategy.validate(
      { query: {}, googleSignupRole: Role.USER } as Parameters<
        GoogleStrategy['validate']
      >[0],
      'access-token',
      'refresh-token',
      profile,
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: Role.USER,
        candidateDiscoverable: true,
      }),
    });
  });

  it('creates new Google accounts with the selected employer role', async () => {
    const { prisma, strategy } = createStrategy();
    const createdUser = { id: 17, email: 'hiring@example.com', role: Role.EMPLOYER };
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValue(createdUser);

    const result = await strategy.validate(
      { query: {}, googleSignupRole: Role.EMPLOYER } as any,
      'access-token',
      'refresh-token',
      profile as any,
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'hiring@example.com',
        role: Role.EMPLOYER,
      }),
    });
    expect(result).toBe(createdUser);
  });

  it('does not allow Google state to create admin accounts', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(null);

    await expect(
      strategy.validate(
        { query: {} } as any,
        'access-token',
        'refresh-token',
        profile as any,
      ),
    ).rejects.toThrow('Account type is required for Google signup');

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('allows existing users to sign in with Google without a signup role', async () => {
    const { prisma, strategy } = createStrategy();
    const existingUser = { id: 19, email: 'hiring@example.com', role: Role.EMPLOYER };
    prisma.user.findUnique.mockResolvedValueOnce(existingUser);

    const result = await strategy.validate(
      { query: {} } as any,
      'access-token',
      'refresh-token',
      profile as any,
    );

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result).toBe(existingUser);
  });

  it('does not overwrite an existing Google user role when signup sends a different role', async () => {
    const { prisma, strategy } = createStrategy();
    const existingUser = { id: 19, email: 'hiring@example.com', role: Role.EMPLOYER };
    prisma.user.findUnique.mockResolvedValueOnce(existingUser);

    const result = await strategy.validate(
      { query: {}, googleSignupRole: Role.USER } as any,
      'access-token',
      'refresh-token',
      profile as any,
    );

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result).toBe(existingUser);
  });

  it('links Google to an existing email account without changing its role', async () => {
    const { prisma, strategy } = createStrategy();
    const existingEmailUser = { id: 21, email: 'hiring@example.com', role: Role.EMPLOYER };
    const linkedUser = { ...existingEmailUser, googleId: 'google-user-id' };
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(existingEmailUser);
    prisma.user.update.mockResolvedValue(linkedUser);

    const result = await strategy.validate(
      { query: {}, googleSignupRole: Role.USER } as any,
      'access-token',
      'refresh-token',
      profile as any,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: existingEmailUser.id },
      data: { googleId: 'google-user-id' },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result).toBe(linkedUser);
  });

  it('normalizes Google email before linking or creating users', async () => {
    const { prisma, strategy } = createStrategy();
    const upperCaseProfile = {
      ...profile,
      emails: [{ value: '  Hiring@Example.COM ' }],
    };
    const existingEmailUser = { id: 21, email: 'hiring@example.com', role: Role.EMPLOYER };
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(existingEmailUser);
    prisma.user.update.mockResolvedValue({ ...existingEmailUser, googleId: 'google-user-id' });

    await strategy.validate(
      { query: {} } as any,
      'access-token',
      'refresh-token',
      upperCaseProfile as any,
    );

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'hiring@example.com', mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
  });

  it('linking Google to an address nobody proved drops the unknown password (pre-hijack)', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 30,
      email: 'hiring@example.com',
      password: 'attacker-hash',
      emailVerifiedAt: null,
    });
    prisma.user.update.mockResolvedValue({ id: 30 });

    await strategy.validate({ query: {} } as any, 'a', 'r', profile as any);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: {
        googleId: 'google-user-id',
        password: null,
        emailVerifiedAt: expect.any(Date),
      },
    });
  });

  it('linking Google to a verified account keeps its password', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 31,
      email: 'hiring@example.com',
      password: 'owner-hash',
      emailVerifiedAt: new Date('2026-01-01'),
    });
    prisma.user.update.mockResolvedValue({ id: 31 });

    await strategy.validate({ query: {} } as any, 'a', 'r', profile as any);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: { googleId: 'google-user-id' },
    });
  });

  it('new Google accounts start verified; an address Google has not verified is refused', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValue({ id: 32 });
    await strategy.validate(
      { query: {}, googleSignupRole: Role.USER } as any,
      'a',
      'r',
      profile as any,
    );
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
    });

    await expect(
      strategy.validate({ query: {} } as any, 'a', 'r', {
        ...profile,
        _json: { email_verified: false },
      } as any),
    ).rejects.toMatchObject({ status: 401 });
  });
});
