import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma.service';
import { ChatSocketAuthService } from './chat-socket-auth.service';

describe('ChatSocketAuthService', () => {
  it('accepts a valid short-lived realtime ticket', async () => {
    const jwtService = {
      verify: jest.fn().mockReturnValue({ sub: 6, type: 'socket' }),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 6, name: 'Tai', avatar: null }),
      },
    };
    const service = new ChatSocketAuthService(
      jwtService as unknown as JwtService,
      { get: jest.fn().mockReturnValue('secret') } as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
    const next = jest.fn();
    const socket = {
      data: {},
      handshake: { auth: { token: 'socket-token' }, headers: {} },
    };

    await service.authenticateSocket(socket as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toEqual({ user: { id: 6, name: 'Tai', avatar: null } });
  });
});
