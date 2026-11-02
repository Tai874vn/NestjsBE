import { JwtService } from '@nestjs/jwt';
import { AuthSessionService } from './auth-session.service';

describe('AuthSessionService access revocation', () => {
  const redis = {
    readSession: jest.fn(), isAccessRevoked: jest.fn(),
    writeSession: jest.fn(), onRevocation: jest.fn(() => () => {}),
  };
  const prisma = { authSession: { findUnique: jest.fn() } };
  const make = () => new AuthSessionService(prisma as never, new JwtService({secret:'test'}), redis as never, {get: () => undefined} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    redis.isAccessRevoked.mockResolvedValue(false);
  });

  it('rejects a revoked session even if its access JWT is unexpired', async () => {
    redis.readSession.mockResolvedValue({userId: 7, revoked: true});
    await expect(make().assertAccessSession('session', 7)).rejects.toMatchObject({response: {code:'SESSION_REVOKED'}});
  });

  it('fails open only when Redis is unavailable, without querying PostgreSQL', async () => {
    redis.readSession.mockResolvedValue(undefined);
    await expect(make().assertAccessSession('session', 7)).resolves.toBeUndefined();
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
  });

  it('does not fail open for a cache miss referring to a revoked PostgreSQL session', async () => {
    redis.readSession.mockResolvedValue(null);
    prisma.authSession.findUnique.mockResolvedValue({userId:7, revokedAt:new Date(), expiresAt:new Date(Date.now()+60000)});
    await expect(make().assertAccessSession('session', 7)).rejects.toMatchObject({response:{code:'SESSION_REVOKED'}});
  });

  it('rejects a blacklisted access jti', async () => {
    redis.isAccessRevoked.mockResolvedValue(true);
    await expect(make().assertAccessSession('session', 7, 'jti')).rejects.toMatchObject({response:{code:'SESSION_REVOKED'}});
  });
});
