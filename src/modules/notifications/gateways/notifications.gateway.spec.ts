import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma.service';
import { NotificationsGateway } from './notifications.gateway';

describe('NotificationsGateway token extraction', () => {
  const createGateway = () =>
    new NotificationsGateway(
      {} as JwtService,
      {} as ConfigService,
      {} as PrismaService,
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
      verify: jest.fn().mockReturnValue({ sub: 6, type: 'socket' }),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 6, name: 'Tai', avatar: null }),
      },
    };
    const gateway = new NotificationsGateway(
      jwtService as unknown as JwtService,
      { get: jest.fn().mockReturnValue('secret') } as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
    const next = jest.fn();
    const socket = {
      data: {},
      handshake: { auth: { token: 'socket-token' }, headers: {}, query: {} },
    };

    await gateway['authenticateSocket'](socket as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toEqual({ user: { id: 6, name: 'Tai', avatar: null } });
  });
});
