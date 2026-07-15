import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { PrismaService } from '../../../prisma.service';
import { AuthenticatedSocket } from './authenticated-socket.type';

@Injectable()
export class ChatSocketAuthService {
  private readonly logger = new Logger('ChatSocketAuthService');

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticateSocket(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void,
  ): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) {
        return next(new UnauthorizedException('No token provided'));
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (payload.type !== 'access') {
        return next(new UnauthorizedException('Invalid access token'));
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, avatar: true },
      });

      if (!user) {
        return next(new UnauthorizedException('User not found'));
      }

      socket.data.user = user;
      next();
    } catch (error) {
      this.logger.error(`Authentication error: ${this.getErrMsg(error)}`);
      next(new UnauthorizedException('Invalid token'));
    }
  }

  extractToken(socket: Socket): string | null {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) {
      return authToken;
    }

    const authHeader = socket.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    const cookies = socket.handshake.headers.cookie;
    if (cookies) {
      const tokenCookie = cookies
        .split(';')
        .find((cookie) => cookie.trim().startsWith('access_token='));
      if (tokenCookie) {
        return decodeURIComponent(tokenCookie.split('=').slice(1).join('='));
      }
    }

    return null;
  }

  private getErrMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
