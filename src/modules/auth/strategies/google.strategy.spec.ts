import { Role } from '../../../common/constants/roles';
import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  const createStrategy = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
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

  it('creates new Google accounts with the selected employer role', async () => {
    const { prisma, strategy } = createStrategy();
    const createdUser = { id: 17, email: 'hiring@example.com', role: Role.EMPLOYER };
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValue(createdUser);
    const done = jest.fn();

    await strategy.validate(
      { query: { state: Role.EMPLOYER } } as any,
      'access-token',
      'refresh-token',
      profile as any,
      done,
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'hiring@example.com',
        role: Role.EMPLOYER,
      }),
    });
    expect(done).toHaveBeenCalledWith(null, createdUser);
  });

  it('does not allow Google state to create admin accounts', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const done = jest.fn();

    await strategy.validate(
      { query: { state: Role.ADMIN } } as any,
      'access-token',
      'refresh-token',
      profile as any,
      done,
    );

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Account type is required for Google signup',
      }),
      false,
    );
  });

  it('allows existing users to sign in with Google without a signup role', async () => {
    const { prisma, strategy } = createStrategy();
    const existingUser = { id: 19, email: 'hiring@example.com', role: Role.EMPLOYER };
    prisma.user.findUnique.mockResolvedValueOnce(existingUser);
    const done = jest.fn();

    await strategy.validate(
      { query: {} } as any,
      'access-token',
      'refresh-token',
      profile as any,
      done,
    );

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(null, existingUser);
  });
});
