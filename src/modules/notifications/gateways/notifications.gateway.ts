import { trustedOrigins } from '../../../common/config/trusted-origins';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../../prisma.service';
import { AuthSessionService } from '../../auth/session/auth-session.service';
import { jwtVerifyOptions } from '../../auth/session/auth-jwt.config';
import type {
  AuthenticatedSocket,
  RealtimeSocketClaims,
} from '../../chat/services/authenticated-socket.type';

type NotificationPayload = {
  id: number;
  recipientId: number;
  [key: string]: unknown;
};

/**
 * REAL-TIME NOTIFICATIONS (the bell icon). Works like the chat gateway, on its own namespace
 * /notifications (a namespace = a separate channel on the same Socket.IO server).
 *
 * On connect, the login token is checked and the socket joins a room just for this user (userRoom),
 * so "send to user 7" reaches every open tab of user 7 — on any backend copy, thanks to the Redis adapter.
 * NotificationsService.create saves a notification in the database, then calls emitNotification and
 * emitUnreadCount here, so the bell updates at once without reloading the page.
 */
@WebSocketGateway({
  cors: {
    origin: trustedOrigins(),
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('NotificationsGateway');
  private unsubscribeRevoked?: () => void;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService,
  ) {}

  afterInit(server: Server) {
    this.unsubscribeRevoked?.();
    this.unsubscribeRevoked = this.sessions.onRevoked((sid) => {
      server.local.in(`auth-session:${sid}`).disconnectSockets(true);
    });
    server.use((socket: AuthenticatedSocket, next) => {
      void this.authenticateSocket(socket, next);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribeRevoked?.();
    this.unsubscribeRevoked = undefined;
  }

  async handleConnection(client: AuthenticatedSocket) {
    const user = client.data.user;
    const sessionId = client.data.sessionId;
    if (!user || !sessionId) {
      client.disconnect();
      return;
    }

    if (!client.connected) return;

    try {
      await client.join(`auth-session:${sessionId}`);
      if (!client.connected) return;

      // Cover revocation during the handshake lookup, before the room existed.
      await this.sessions.assertAccessSession(
        sessionId,
        user.id,
        client.data.jti,
      );
      if (!client.connected) return;

      await client.join(this.userRoom(user.id));
      if (!client.connected) return;
      this.logger.log(
        `User ${user.name} (${user.id}) connected to notifications`,
      );
    } catch (error) {
      this.logger.error(
        `Connection error: ${error instanceof Error ? error.message : String(error)}`,
      );
      client.disconnect(true);
    }
  }

  emitNotification(recipientId: number, notification: NotificationPayload) {
    this.server
      ?.to(this.userRoom(recipientId))
      .emit('notification:new', notification);
  }

  emitUnreadCount(recipientId: number, unreadCount: number) {
    this.server
      ?.to(this.userRoom(recipientId))
      .emit('notifications:unread-count', { unreadCount });
  }

  private async authenticateSocket(
    socket: AuthenticatedSocket,
    next: (err?: Error) => void,
  ): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) return next(new UnauthorizedException('No token provided'));

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
      if (!user) return next(new UnauthorizedException('User not found'));

      socket.data.user = user;
      socket.data.sessionId = payload.sid;
      socket.data.jti = payload.jti;
      next();
    } catch (error) {
      this.logger.error(
        `Authentication error: ${error instanceof Error ? error.message : String(error)}`,
      );
      next(new UnauthorizedException('Invalid token'));
    }
  }

  private userRoom(userId: number) {
    return `user:${userId}`;
  }

  private extractToken(socket: Socket): string | null {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) return authToken;

    const authHeader = socket.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer '))
      return authHeader.slice(7);

    const cookies = socket.handshake.headers.cookie;
    if (!cookies) return null;

    const tokenCookie = cookies
      .split(';')
      .find((cookie) => cookie.trim().startsWith('access_token='));
    if (!tokenCookie) return null;

    return decodeURIComponent(tokenCookie.split('=').slice(1).join('='));
  }
}
