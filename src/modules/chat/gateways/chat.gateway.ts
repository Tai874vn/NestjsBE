import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Logger,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
  Inject,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { PrismaService } from '../../../prisma.service';
import { ChatService } from '../services/chat.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import {
  SendMessageDto,
  JoinRoomDto,
  TypingDto,
  CreateRoomDto,
  MarkAsReadDto,
} from '../dto/chat.dto';

interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      id: number;
      name: string;
      avatar: string | null;
    };
  };
}

const ONLINE_KEY_PREFIX = 'chat:online:';
const ONLINE_TTL = 60 * 60; // 1 hour — refreshed on every connection

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
  namespace: '/chat',
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('ChatGateway');
  // In-memory fallback when Redis is not available
  private onlineUsers = new Map<number, Set<string>>();
  private redisClient: ReturnType<typeof createClient> | null = null;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private chatService: ChatService,
    @Optional()
    @Inject(REDIS_CLIENT)
    private injectedRedisClient: ReturnType<typeof createClient> | null,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');

    // Use injected Redis client for online user tracking (adapter is set up in main.ts)
    if (this.injectedRedisClient) {
      this.redisClient = this.injectedRedisClient;
      this.logger.log('Redis client available for online user tracking');
    } else {
      this.logger.log('No Redis client — using in-memory online tracking');
    }

    // Authentication middleware
    server.use((socket: AuthenticatedSocket, next) => {
      void this.authenticateSocket(socket, next);
    });
  }

  private async authenticateSocket(
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

  async handleConnection(client: AuthenticatedSocket) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    this.logger.log(`User ${user.name} (${user.id}) connected: ${client.id}`);

    // Track online status
    await this.addOnlineUser(user.id, client.id);

    // Auto-join user's rooms
    const rooms = await this.chatService.getUserRooms(user.id);
    for (const room of rooms) {
      await client.join(`room:${room.id}`);
    }

    // Broadcast online status — deduplicate so each user receives it once
    const notifiedUsers = new Set<number>();
    for (const room of rooms) {
      for (const member of room.members) {
        if (member.id !== user.id && !notifiedUsers.has(member.id)) {
          notifiedUsers.add(member.id);
          const memberSockets = await this.getOnlineSockets(member.id);
          for (const socketId of memberSockets) {
            this.server.to(socketId).emit('user-online', {
              userId: user.id,
              name: user.name,
              avatar: user.avatar,
            });
          }
        }
      }
    }

    // Send user their rooms
    client.emit('rooms-list', rooms);
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const user = client.data.user;
    if (!user) return;

    this.logger.log(
      `User ${user.name} (${user.id}) disconnected: ${client.id}`,
    );

    // Remove socket from tracking
    const remainingSockets = await this.removeOnlineUser(user.id, client.id);
    if (remainingSockets === 0) {
      try {
        const roomIds = await this.chatService.getUserRoomIds(user.id);
        for (const roomId of roomIds) {
          this.server.to(`room:${roomId}`).emit('user-offline', {
            userId: user.id,
          });
        }
      } catch (error) {
        this.logger.error(
          `Disconnect broadcast error: ${this.getErrMsg(error)}`,
        );
      }
    }
  }

  @SubscribeMessage('create-room')
  async handleCreateRoom(
    @MessageBody() data: CreateRoomDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const room = await this.chatService.createRoom(user.id, data);

      // Join creator to the room
      await client.join(`room:${room.id}`);

      // Notify all members
      for (const member of room.members) {
        const memberSockets = await this.getOnlineSockets(member.id);
        for (const socketId of memberSockets) {
          const memberSocket = this.server.sockets.sockets.get(socketId);
          if (memberSocket) {
            await memberSocket.join(`room:${room.id}`);
            memberSocket.emit('room-created', room);
          }
        }
      }

      return { status: 'success', room };
    } catch (error) {
      this.logger.error(`Create room error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to create room' };
    }
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @MessageBody() data: JoinRoomDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const room = await this.chatService.getRoom(data.roomId, user.id);

      await client.join(`room:${data.roomId}`);

      // Notify room members
      this.server.to(`room:${data.roomId}`).emit('user-joined-room', {
        roomId: data.roomId,
        user: { id: user.id, name: user.name, avatar: user.avatar },
      });

      // Send latest room messages to the user
      const messages = await this.chatService.getMessages(user.id, {
        roomId: data.roomId,
      });

      return { status: 'success', room, messages };
    } catch (error) {
      this.logger.error(`Join room error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to join room' };
    }
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @MessageBody() data: JoinRoomDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;

      await client.leave(`room:${data.roomId}`);
      await this.chatService.leaveRoom(data.roomId, user.id);

      // Notify room members
      this.server.to(`room:${data.roomId}`).emit('user-left-room', {
        roomId: data.roomId,
        userId: user.id,
      });

      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Leave room error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to leave room' };
    }
  }

  @SubscribeMessage('send-message')
  async handleMessage(
    @MessageBody() data: SendMessageDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const message = await this.chatService.saveMessage(user.id, data);

      // Broadcast to all room members
      this.server.to(`room:${data.roomId}`).emit('new-message', message);

      return { status: 'success', message };
    } catch (error) {
      this.logger.error(`Send message error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to send message' };
    }
  }

  @SubscribeMessage('get-messages')
  async handleGetMessages(
    @MessageBody() data: { roomId: number; limit?: number; before?: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const messages = await this.chatService.getMessages(user.id, {
        roomId: data.roomId,
        limit: data.limit || 50,
        before: data.before,
      });

      return { status: 'success', messages };
    } catch (error) {
      this.logger.error(`Get messages error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to get messages' };
    }
  }

  @SubscribeMessage('mark-as-read')
  async handleMarkAsRead(
    @MessageBody() data: MarkAsReadDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const updated = await this.chatService.markAsRead(data.roomId, user.id);

      if (updated) {
        // Only broadcast if user was actually a member
        client.to(`room:${data.roomId}`).emit('messages-read', {
          roomId: data.roomId,
          userId: user.id,
        });
      }

      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Mark as read error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to mark as read' };
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: TypingDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    const user = client.data.user!;

    // Broadcast to room except sender
    client.to(`room:${data.roomId}`).emit('user-typing', {
      roomId: data.roomId,
      userId: user.id,
      name: user.name,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('get-online-users')
  async handleGetOnlineUsers(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const user = client.data.user!;
      const rooms = await this.chatService.getUserRooms(user.id);

      // Collect unique user IDs from shared rooms, filtered to online only
      const contactIds = new Set<number>();
      for (const room of rooms) {
        for (const member of room.members) {
          if (member.id !== user.id && (await this.isUserOnline(member.id))) {
            contactIds.add(member.id);
          }
        }
      }

      return { status: 'success', onlineUsers: Array.from(contactIds) };
    } catch (error) {
      this.logger.error(`Get online users error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to get online users' };
    }
  }

  @SubscribeMessage('get-rooms')
  async handleGetRooms(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const user = client.data.user!;
      const rooms = await this.chatService.getUserRooms(user.id);
      return { status: 'success', rooms };
    } catch (error) {
      this.logger.error(`Get rooms error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to get rooms' };
    }
  }

  // ─── Online user tracking (Redis-backed with in-memory fallback) ───

  private async addOnlineUser(userId: number, socketId: string): Promise<void> {
    if (this.redisClient) {
      const key = `${ONLINE_KEY_PREFIX}${userId}`;
      await this.redisClient.sAdd(key, socketId);
      await this.redisClient.expire(key, ONLINE_TTL);
    } else {
      if (!this.onlineUsers.has(userId)) {
        this.onlineUsers.set(userId, new Set());
      }
      this.onlineUsers.get(userId)!.add(socketId);
    }
  }

  private async removeOnlineUser(
    userId: number,
    socketId: string,
  ): Promise<number> {
    if (this.redisClient) {
      const key = `${ONLINE_KEY_PREFIX}${userId}`;
      await this.redisClient.sRem(key, socketId);
      const remaining = await this.redisClient.sCard(key);
      if (remaining === 0) {
        await this.redisClient.del(key);
      }
      return remaining;
    } else {
      const sockets = this.onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socketId);
        if (sockets.size === 0) {
          this.onlineUsers.delete(userId);
          return 0;
        }
        return sockets.size;
      }
      return 0;
    }
  }

  private async getOnlineSockets(userId: number): Promise<string[]> {
    if (this.redisClient) {
      const key = `${ONLINE_KEY_PREFIX}${userId}`;
      return this.redisClient.sMembers(key);
    } else {
      const sockets = this.onlineUsers.get(userId);
      return sockets ? Array.from(sockets) : [];
    }
  }

  private async isUserOnline(userId: number): Promise<boolean> {
    if (this.redisClient) {
      const key = `${ONLINE_KEY_PREFIX}${userId}`;
      const count = await this.redisClient.sCard(key);
      return count > 0;
    } else {
      return this.onlineUsers.has(userId);
    }
  }

  // ─── Error helper ───

  private getErrMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // ─── Token extraction ───

  private extractToken(socket: Socket): string | null {
    // Try auth object first (recommended)
    if (socket.handshake.auth?.token) {
      return socket.handshake.auth.token;
    }

    // Try Authorization header
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Try query parameter
    if (socket.handshake.query?.token) {
      return socket.handshake.query.token as string;
    }

    // Try cookie
    const cookies = socket.handshake.headers.cookie;
    if (cookies) {
      const tokenCookie = cookies
        .split(';')
        .find((c) => c.trim().startsWith('access_token='));
      if (tokenCookie) {
        return tokenCookie.split('=')[1];
      }
    }

    return null;
  }
}
