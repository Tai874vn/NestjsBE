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
});
