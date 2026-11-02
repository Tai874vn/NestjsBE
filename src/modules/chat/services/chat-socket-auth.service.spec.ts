import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';

jest.mock('../../auth/session/auth-session.service', () => ({
  AuthSessionService: class {},
}));

describe('ChatSocketAuthService', () => {
  beforeAll(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      JWT_ISSUER: 'test-issuer',
      JWT_AUDIENCE: 'test-audience',
    });
  });
  afterAll(() => jest.restoreAllMocks());

  const claims = {
    sub: 6,
    sid: 'session-6',
    jti: 'ticket-6',
    role: 'USER',
    type: 'socket',
  };
  const createService = () => {
    const jwt = new JwtService({
      secret: 'test-secret',
      signOptions: { issuer: 'test-issuer', audience: 'test-audience' },
    });
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 6, name: 'Tai', avatar: null }),
      },
    };
    const sessions = {
      assertAccessSession: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ChatSocketAuthService(
      jwt,
      {
        get: jest.fn().mockReturnValue('test-secret'),
      } as unknown as ConfigService,
      prisma as unknown as PrismaService,
      sessions as never,
    );
    const authenticate = async (payload: object, options = {}) => {
      const socket = {
        data: {},
        handshake: { auth: { token: jwt.sign(payload, options) }, headers: {} },
      };
      const next = jest.fn();
      await service.authenticateSocket(socket as never, next);
      return { socket, next };
    };
    return { service, sessions, prisma, authenticate };
  };

  it.each(['socket', 'access'])(
    'accepts a session-bound %s token',
    async (type) => {
      const { authenticate, sessions } = createService();
      const { socket, next } = await authenticate({ ...claims, type });

      expect(next).toHaveBeenCalledWith();
      expect(socket.data).toEqual({
        user: { id: 6, name: 'Tai', avatar: null },
        sessionId: 'session-6',
        jti: 'ticket-6',
      });
      expect(sessions.assertAccessSession).toHaveBeenCalledWith(
        'session-6',
        6,
        'ticket-6',
      );
    },
  );

  it.each([
    { sid: undefined },
    { sid: '' },
    { sid: ' ' },
    { sid: 6 },
    { jti: undefined },
    { jti: '' },
    { jti: ' ' },
    { jti: 6 },
    { type: undefined },
    { type: 'refresh' },
    { sub: '6' },
    { sub: 0 },
    { sub: -1 },
    { sub: 1.5 },
  ])(
    'rejects malformed or legacy claims %j before session lookup',
    async (changes) => {
      const { authenticate, sessions, prisma } = createService();
      const { socket, next } = await authenticate({ ...claims, ...changes });

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
      expect(socket.data).toEqual({});
      expect(sessions.assertAccessSession).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    { issuer: 'other-issuer' },
    { audience: 'other-audience' },
    { algorithm: 'HS384' },
    { expiresIn: -1 },
  ])('verifies JWT restrictions before session lookup: %j', async (options) => {
    const { authenticate, sessions } = createService();
    const { next } = await authenticate(claims, options);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(sessions.assertAccessSession).not.toHaveBeenCalled();
  });

  it('rejects revoked sessions without attaching a socket identity', async () => {
    const { authenticate, sessions, prisma } = createService();
    sessions.assertAccessSession.mockRejectedValue(new UnauthorizedException());
    const { socket, next } = await authenticate(claims);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(socket.data).toEqual({});
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each(['access', 'socket'])(
    'rejects a blacklisted %s JWT by its jti',
    async (type) => {
      const { authenticate, sessions, prisma } = createService();
      sessions.assertAccessSession.mockImplementation(
        (_sid: string, _userId: number, jti?: string) =>
          jti === 'blocked-jti'
            ? Promise.reject(new UnauthorizedException())
            : Promise.resolve(),
      );

      const { socket, next } = await authenticate({
        ...claims,
        type,
        jti: 'blocked-jti',
      });

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
      expect(socket.data).toEqual({});
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('accepts a session when the session service permits degraded access', async () => {
    const { authenticate, sessions } = createService();
    sessions.assertAccessSession.mockResolvedValue(undefined);

    const { next } = await authenticate(claims);

    expect(next).toHaveBeenCalledWith();
    expect(sessions.assertAccessSession).toHaveBeenCalledTimes(1);
  });

  it('rejects a token whose user no longer exists', async () => {
    const { authenticate, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    const { socket, next } = await authenticate(claims);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(socket.data).toEqual({});
  });
});
