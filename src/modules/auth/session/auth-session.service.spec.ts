import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { ACCOUNT_HAS_CONTRACTS, AuthSessionService } from './auth-session.service';

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

describe('AuthSessionService.deleteUser (account delete)', () => {
  function setup(contracts: number) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 7 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      contract: { count: jest.fn().mockResolvedValue(contracts) },
      authSession: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    const redis = {
      onRevocation: jest.fn(() => () => {}),
      revokeSessions: jest.fn(), deleteSessions: jest.fn(), writeSession: jest.fn(),
    };
    const service = new AuthSessionService(prisma as never, new JwtService({ secret: 'test' }), redis as never, { get: () => undefined } as never);
    return { tx, service };
  }

  it('refuses (409) an account that is a side of any contract, and deletes nothing', async () => {
    const { tx, service } = setup(2);
    await expect(service.deleteUser(7)).rejects.toThrow(new ConflictException(ACCOUNT_HAS_CONTRACTS));
    expect(tx.contract.count).toHaveBeenCalledWith({
      where: { OR: [{ clientId: 7 }, { freelancerId: 7 }] },
    });
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('a delete the database refuses (P2003, a contract made meanwhile) is also 409', async () => {
    const { tx, service } = setup(0);
    tx.user.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'test' }),
    );
    await expect(service.deleteUser(7)).rejects.toThrow(new ConflictException(ACCOUNT_HAS_CONTRACTS));
  });

  it('an account with no contracts is deleted', async () => {
    const { tx, service } = setup(0);
    await service.deleteUser(7);
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});

describe('AuthSessionService.resetPassword (forgot password)', () => {
  function setup(user: { id: number; email: string; emailVerifiedAt: Date | null }) {
    const session = { id: 's1', userId: user.id, expiresAt: new Date() };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue({}),
      },
      authSession: {
        findMany: jest.fn().mockResolvedValue([session]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      authRefreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    const redis = {
      onRevocation: jest.fn(() => () => {}),
      revokeSession: jest.fn(),
      publishRevocation: jest.fn(),
    };
    const service = new AuthSessionService(prisma as never, new JwtService({ secret: 'test' }), redis as never, { get: () => undefined } as never);
    return { tx, redis, service };
  }

  it('saves a new hash, bumps tokenVersion and revokes every session', async () => {
    const { tx, redis, service } = setup({ id: 7, email: 'a@b.c', emailVerifiedAt: new Date() });
    await service.resetPassword(7, 'new-password-123', 'a@b.c');
    const data = tx.user.update.mock.calls[0][0].data;
    expect(data.password).toMatch(/^\$2[aby]\$12\$/);
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data).not.toHaveProperty('emailVerifiedAt');
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(redis.revokeSession).toHaveBeenCalledWith('s1', 7, expect.any(Date));
  });

  it('also verifies an unverified address, because the link reached that inbox', async () => {
    const { tx, service } = setup({ id: 8, email: 'A@b.c', emailVerifiedAt: null });
    await service.resetPassword(8, 'new-password-123', 'a@b.c');
    expect(tx.user.update.mock.calls[0][0].data.emailVerifiedAt).toEqual(expect.any(Date));
  });
});
