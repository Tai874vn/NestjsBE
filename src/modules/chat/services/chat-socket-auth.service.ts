/**
 * Socket authentication service for the chat module.
 * It extracts a JWT from socket handshake auth, headers, or cookies, verifies the session, and attaches the user to the socket.
 *
 * Calls: JwtService; AuthSessionService; jwtVerifyOptions; prisma.user
 * Used by:
 *   - src/modules/chat/chat.module.ts
 *   - src/modules/chat/gateways/chat.gateway.ts
 */

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { PrismaService } from '../../../prisma.service';
import { AuthSessionService } from '../../auth/session/auth-session.service';
import { jwtVerifyOptions } from '../../auth/session/auth-jwt.config';
import type {
  AuthenticatedSocket,
  RealtimeSocketClaims,
} from '../utils/authenticated-socket.type';

@Injectable()
export class ChatSocketAuthService {
  private readonly logger = new Logger('ChatSocketAuthService');

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService,
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

      const payload = this.jwtService.verify<RealtimeSocketClaims>(token, {
        ...jwtVerifyOptions(),
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (
        !payload ||
        (payload.type !== 'access' && payload.type !== 'socket') ||
        !Number.isSafeInteger(payload.sub) ||
        payload.sub <= 0 ||
        typeof payload.sid !== 'string' ||
        !payload.sid.trim() ||
        typeof payload.jti !== 'string' ||
        !payload.jti.trim()
      ) {
        return next(new UnauthorizedException('Invalid realtime token'));
      }

      await this.sessions.assertAccessSession(
        payload.sid,
        payload.sub,
        payload.jti,
      );

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, avatar: true },
      });

      if (!user) {
        return next(new UnauthorizedException('User not found'));
      }

      socket.data.user = user;
      socket.data.sessionId = payload.sid;
      socket.data.jti = payload.jti;
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
