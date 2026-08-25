import { UnauthorizedException } from '@nestjs/common';
import { JwtPayload } from '../../../types';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy token purpose', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('rejects a refresh token used as an access token before loading a user', async () => {
    const prisma = { user: { findUnique: jest.fn() } };
    const strategy = new JwtStrategy(prisma as never);
    const payload = { sub: 6, email: 'tai@example.com', type: 'refresh' } as unknown as JwtPayload;

    await expect(strategy.validate({} as never, payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('reuses the validated user when global and controller guards both run', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 6,
          email: 'tai@example.com',
          role: 'user',
        }),
      },
    };
    const strategy = new JwtStrategy(prisma as never);
    const request = {} as never;
    const payload = {
      sub: 6,
      email: 'tai@example.com',
      type: 'access',
    } as JwtPayload;

    await strategy.validate(request, payload);
    await strategy.validate(request, payload);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
