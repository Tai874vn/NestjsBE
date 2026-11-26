import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../../prisma.service';
import { NotificationsGateway } from '../notifications.gateway';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedSocket } from '../../../chat/utils/authenticated-socket.type';

jest.mock('../../../auth/session/auth-session.service', () => ({
  AuthSessionService: class {},
}));

describe('NotificationsGateway token extraction', () => {
  const createGateway = () =>
    new NotificationsGateway(
      {} as JwtService,
      {} as ConfigService,
      {} as PrismaService,
      {} as never,
    );

  it('does not accept access tokens from socket query strings', () => {
    const gateway = createGateway();
    const socket = {
      handshake: {
        auth: {},
        headers: {},
        query: { token: 'query-token' },
      },
    };

    expect(gateway['extractToken'](socket as never)).toBeNull();
  });

  it('accepts cookie tokens for socket authentication', () => {
    const gateway = createGateway();
    const socket = {
      handshake: {
        auth: {},
        headers: { cookie: 'theme=light; access_token=cookie%2Etoken' },
        query: {},
      },
    };

    expect(gateway['extractToken'](socket as never)).toBe('cookie.token');
  });

  it('accepts a valid short-lived realtime ticket', async () => {
    const jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: 6,
        type: 'socket',
        sid: 'session-6',
        jti: 'ticket-6',
      }),
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 6, name: 'Tai', avatar: null }),
      },
    };
    const gateway = new NotificationsGateway(
      jwtService as unknown as JwtService,
      { get: jest.fn().mockReturnValue('secret') } as unknown as ConfigService,
      prisma as unknown as PrismaService,
      { assertAccessSession: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const next = jest.fn();
    const socket = {
      data: {},
      handshake: { auth: { token: 'socket-token' }, headers: {}, query: {} },
    };

    await gateway['authenticateSocket'](socket as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toEqual({
      user: { id: 6, name: 'Tai', avatar: null },
      sessionId: 'session-6',
      jti: 'ticket-6',
    });
  });
});

describe('NotificationsGateway session authentication', () => {
  beforeAll(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      JWT_ISSUER: 'test-issuer',
      JWT_AUDIENCE: 'test-audience',
    });
  });
  afterAll(() => jest.restoreAllMocks());

  const claims = { sub: 6, sid: 'session-6', jti: 'ticket-6', type: 'socket' };
  const createGateway = () => {
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
    const listeners = new Set<(sid: string) => void>();
    const unsubscribe = jest.fn(() => listeners.clear());
    const sessions = {
      assertAccessSession: jest.fn().mockResolvedValue(undefined),
      onRevoked: (listener: (sid: string) => void) => {
        listeners.add(listener);
        return unsubscribe;
      },
    };
    const gateway = new NotificationsGateway(
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
      await gateway['authenticateSocket'](socket as never, next);
      return { socket, next };
    };
    return {
      gateway,
      sessions,
      prisma,
      authenticate,
      unsubscribe,
      revoke: (sid: string) => listeners.forEach((listener) => listener(sid)),
    };
  };

  it.each(['access', 'socket'])(
    'authenticates session-bound %s tokens',
    async (type) => {
      const { authenticate, sessions } = createGateway();
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
    { sub: '6' },
    { sub: 0 },
    { sub: -1 },
    { sub: 1.5 },
    { type: undefined },
    { type: 'refresh' },
  ])(
    'rejects malformed claims before looking up sessions: %j',
    async (changes) => {
      const { authenticate, sessions, prisma } = createGateway();
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
  ])(
    'rejects JWT restriction violations before session lookup: %j',
    async (options) => {
      const { authenticate, sessions } = createGateway();
      const { next } = await authenticate(claims, options);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
      expect(sessions.assertAccessSession).not.toHaveBeenCalled();
    },
  );

  it('rejects revoked sessions before attaching identity', async () => {
    const { authenticate, sessions, prisma } = createGateway();
    sessions.assertAccessSession.mockRejectedValue(new UnauthorizedException());
    const { socket, next } = await authenticate(claims);

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
    expect(socket.data).toEqual({});
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each(['access', 'socket'])(
    'rejects a blacklisted %s JWT by its jti',
    async (type) => {
      const { authenticate, sessions, prisma } = createGateway();
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

  it('joins the session room before the notification user room', async () => {
    const { gateway } = createGateway();
    const client = {
      connected: true,
      data: {
        user: { id: 6, name: 'Tai', avatar: null },
        sessionId: 'session-6',
      },
      join: jest.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenNthCalledWith(1, 'auth-session:session-6');
    expect(client.join).toHaveBeenNthCalledWith(2, 'user:6');
  });

  it('rejects connections without a validated session', async () => {
    const { gateway } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      disconnect: jest.fn(),
      join: jest.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('disconnects the revoked session only, leaving another device for the same user connected', async () => {
    const { gateway, revoke, unsubscribe } = createGateway();
    const devices = ['session-6', 'other-device'].map((sessionId) => ({
      data: { user: { id: 6, name: 'Tai', avatar: null }, sessionId },
      connected: true,
      rooms: new Set<string>(),
      disconnect: jest.fn(),
      join(room: string) {
        this.rooms.add(room);
      },
    }));
    const server = {
      use: jest.fn(),
      local: {
        in: (room: string) => ({
          disconnectSockets: (close: boolean) =>
            devices
              .filter((device) => device.rooms.has(room))
              .forEach((device) => device.disconnect(close)),
        }),
      },
    };
    gateway.afterInit(server as never);
    for (const device of devices)
      await gateway.handleConnection(device as never);

    revoke('session-6');

    expect(devices[0].disconnect).toHaveBeenCalledWith(true);
    expect(devices[1].disconnect).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
    revoke('other-device');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(devices[1].disconnect).not.toHaveBeenCalled();
  });

  const connectedClient = () => {
    const client = {
      connected: true,
      data: {
        user: { id: 6, name: 'Tai', avatar: null },
        sessionId: 'session-6',
        jti: 'ticket-6',
      },
      join: jest.fn(),
      disconnect: jest.fn(() => {
        client.connected = false;
      }),
    };
    return client;
  };

  it('disconnects a session revoked during the handshake user lookup before joining the user room', async () => {
    const { gateway, sessions, prisma, revoke } = createGateway();
    const client = {
      ...connectedClient(),
      data: {} as AuthenticatedSocket['data'],
      handshake: {
        auth: {
          token: new JwtService({ secret: 'test-secret' }).sign(claims, {
            issuer: 'test-issuer',
            audience: 'test-audience',
          }),
        },
        headers: {},
      },
    };
    client.disconnect.mockImplementation(() => {
      client.connected = false;
    });
    let releaseLookup!: (user: {
      id: number;
      name: string;
      avatar: null;
    }) => void;
    const lookup = new Promise((resolve) => {
      releaseLookup = resolve;
    });
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    prisma.user.findUnique.mockImplementation(() => {
      markLookupStarted();
      return lookup;
    });
    let revoked = false;
    sessions.assertAccessSession.mockImplementation(() =>
      revoked ? Promise.reject(new UnauthorizedException()) : Promise.resolve(),
    );
    gateway.afterInit({
      use: jest.fn(),
      local: { in: () => ({ disconnectSockets: jest.fn() }) },
    } as never);
    const next = jest.fn();
    const handshake = gateway['authenticateSocket'](client as never, next);
    await lookupStarted;

    revoked = true;
    revoke('session-6');
    expect(client.join).not.toHaveBeenCalled();
    releaseLookup({ id: 6, name: 'Tai', avatar: null });
    await handshake;
    expect(next).toHaveBeenCalledWith();

    await expect(
      gateway.handleConnection(client as never),
    ).resolves.toBeUndefined();

    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join.mock.calls).toEqual([['auth-session:session-6']]);
    expect(sessions.assertAccessSession).toHaveBeenNthCalledWith(
      2,
      'session-6',
      6,
      'ticket-6',
    );
    gateway.onModuleDestroy();
  });

  it('rechecks the stored token in between the revocation and user room joins', async () => {
    const { gateway, sessions } = createGateway();
    const client = connectedClient();
    const order: string[] = [];
    client.join.mockImplementation((room: string) => {
      order.push(room);
    });
    sessions.assertAccessSession.mockImplementation(() => {
      order.push('assert-session');
      return Promise.resolve();
    });

    await gateway.handleConnection(client as never);

    expect(order).toEqual([
      'auth-session:session-6',
      'assert-session',
      'user:6',
    ]);
    expect(sessions.assertAccessSession).toHaveBeenCalledWith(
      'session-6',
      6,
      'ticket-6',
    );
  });

  it.each(['already disconnected', 'session room join', 'session recheck'])(
    'does not join the private user room after disconnect at %s',
    async (stage) => {
      const { gateway, sessions } = createGateway();
      const client = connectedClient();
      if (stage === 'already disconnected') client.connected = false;
      if (stage === 'session room join')
        client.join.mockImplementation(() => {
          client.connected = false;
        });
      if (stage === 'session recheck')
        sessions.assertAccessSession.mockImplementation(() => {
          client.connected = false;
          return Promise.resolve();
        });

      await expect(
        gateway.handleConnection(client as never),
      ).resolves.toBeUndefined();

      if (stage === 'already disconnected')
        expect(client.join).not.toHaveBeenCalled();
      else expect(client.join.mock.calls).toEqual([['auth-session:session-6']]);
    },
  );
});
