import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../../prisma.service';
import { JwtPayload } from '../../../types';

type NotificationSocketUser = {
  id: number;
  name: string;
  avatar: string | null;
};

interface AuthenticatedNotificationSocket extends Socket {
  data: {
    user?: NotificationSocketUser;
  };
}

type NotificationPayload = {
  id: number;
  recipientId: number;
  [key: string]: unknown;
};

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('NotificationsGateway');

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    server.use((socket: AuthenticatedNotificationSocket, next) => {
      void this.authenticateSocket(socket, next);
    });
  }

  async handleConnection(client: AuthenticatedNotificationSocket) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    await client.join(this.userRoom(user.id));
    this.logger.log(`User ${user.name} (${user.id}) connected to notifications`);
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
    socket: AuthenticatedNotificationSocket,
    next: (err?: Error) => void,
  ): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) return next(new UnauthorizedException('No token provided'));

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (payload.type !== 'access') {
        return next(new UnauthorizedException('Invalid access token'));
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, avatar: true },
      });
      if (!user) return next(new UnauthorizedException('User not found'));

      socket.data.user = user;
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
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) return authHeader.slice(7);

    const cookies = socket.handshake.headers.cookie;
    if (!cookies) return null;

    const tokenCookie = cookies
      .split(';')
      .find((cookie) => cookie.trim().startsWith('access_token='));
    if (!tokenCookie) return null;

    return decodeURIComponent(tokenCookie.split('=').slice(1).join('='));
  }
}
