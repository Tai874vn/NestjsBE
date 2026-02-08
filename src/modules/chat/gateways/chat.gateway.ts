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
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma.service';
import { ChatService } from '../services/chat.service';
import {
  SendMessageDto,
  JoinRoomDto,
  TypingDto,
  CreateRoomDto,
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

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('ChatGateway');
  private onlineUsers = new Map<number, Set<string>>(); // userId -> socketIds

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private chatService: ChatService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');

    // Authentication middleware
    server.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) {
          return next(new UnauthorizedException('No token provided'));
        }

        const payload = this.jwtService.verify(token, {
          secret: this.configService.get<string>('JWT_SECRET'),
        });

        const user = await this.prisma.nguoiDung.findUnique({
          where: { id: payload.sub },
          select: { id: true, name: true, avatar: true },
        });

        if (!user) {
          return next(new UnauthorizedException('User not found'));
        }

        socket.data.user = user;
        next();
      } catch (error) {
        this.logger.error(`Authentication error: ${error.message}`);
        next(new UnauthorizedException('Invalid token'));
      }
    });
  }

  async handleConnection(client: AuthenticatedSocket) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    this.logger.log(`User ${user.name} (${user.id}) connected: ${client.id}`);

    // Track online status
    if (!this.onlineUsers.has(user.id)) {
      this.onlineUsers.set(user.id, new Set());
    }
    this.onlineUsers.get(user.id)!.add(client.id);

    // Auto-join user's rooms
    const rooms = await this.chatService.getUserRooms(user.id);
    for (const room of rooms) {
      client.join(`room:${room.id}`);
    }

    // Broadcast user online status
    this.server.emit('user-online', {
      userId: user.id,
      name: user.name,
      avatar: user.avatar,
    });

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
    const userSockets = this.onlineUsers.get(user.id);
    if (userSockets) {
      userSockets.delete(client.id);
      if (userSockets.size === 0) {
        this.onlineUsers.delete(user.id);
        // Broadcast user offline status only if no more connections
        this.server.emit('user-offline', { userId: user.id });
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
      client.join(`room:${room.id}`);

      // Notify all members
      for (const member of room.members) {
        const memberSockets = this.onlineUsers.get(member.id);
        if (memberSockets) {
          for (const socketId of memberSockets) {
            const memberSocket = this.server.sockets.sockets.get(socketId);
            if (memberSocket) {
              memberSocket.join(`room:${room.id}`);
              memberSocket.emit('room-created', room);
            }
          }
        }
      }

      return { status: 'success', room };
    } catch (error) {
      this.logger.error(`Create room error: ${error.message}`);
      return { status: 'error', message: error.message };
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

      client.join(`room:${data.roomId}`);

      // Notify room members
      this.server.to(`room:${data.roomId}`).emit('user-joined-room', {
        roomId: data.roomId,
        user: { id: user.id, name: user.name, avatar: user.avatar },
      });

      // Send room messages to the user
      const messages = await this.chatService.getMessages(user.id, {
        roomId: data.roomId,
        limit: 50,
      });

      return { status: 'success', room, messages };
    } catch (error) {
      this.logger.error(`Join room error: ${error.message}`);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @MessageBody() data: JoinRoomDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;

      client.leave(`room:${data.roomId}`);
      await this.chatService.leaveRoom(data.roomId, user.id);

      // Notify room members
      this.server.to(`room:${data.roomId}`).emit('user-left-room', {
        roomId: data.roomId,
        userId: user.id,
      });

      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Leave room error: ${error.message}`);
      return { status: 'error', message: error.message };
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
      this.logger.error(`Send message error: ${error.message}`);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('get-messages')
  async handleGetMessages(
    @MessageBody() data: { roomId: number; limit?: number; offset?: number },
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const messages = await this.chatService.getMessages(user.id, {
        roomId: data.roomId,
        limit: data.limit || 50,
        offset: data.offset || 0,
      });

      return { status: 'success', messages };
    } catch (error) {
      this.logger.error(`Get messages error: ${error.message}`);
      return { status: 'error', message: error.message };
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
  handleGetOnlineUsers() {
    const onlineUserIds = Array.from(this.onlineUsers.keys());
    return { status: 'success', onlineUsers: onlineUserIds };
  }

  @SubscribeMessage('get-rooms')
  async handleGetRooms(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const user = client.data.user!;
      const rooms = await this.chatService.getUserRooms(user.id);
      return { status: 'success', rooms };
    } catch (error) {
      this.logger.error(`Get rooms error: ${error.message}`);
      return { status: 'error', message: error.message };
    }
  }

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
