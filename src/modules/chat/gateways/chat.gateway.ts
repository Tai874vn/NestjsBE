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
import { Server } from 'socket.io';
import {
  Logger,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
  Optional,
  ForbiddenException,
} from '@nestjs/common';
import {
  ObservabilityService,
  OperationTimer,
} from '../../../common/observability/observability.service';
import { ChatService } from '../services/chat.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ChatPresenceService } from '../services/chat-presence.service';
import { ChatSocketAuthService } from '../services/chat-socket-auth.service';
import type { AuthenticatedSocket } from '../services/authenticated-socket.type';
import {
  SendMessageDto,
  JoinRoomDto,
  TypingDto,
  CreateRoomDto,
  MarkAsReadDto,
} from '../dto/chat.dto';

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

  constructor(
    private readonly chatService: ChatService,
    private readonly socketAuth: ChatSocketAuthService,
    private readonly presence: ChatPresenceService,
    @Optional()
    private readonly notifications?: NotificationsService,
    @Optional()
    private readonly observability?: ObservabilityService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');

    this.presence.logMode();
    if (false) {
      this.logger.log('No Redis client — using in-memory online tracking');
    }

    // Authentication middleware
    server.use((socket: AuthenticatedSocket, next) => {
      void this.socketAuth.authenticateSocket(socket, next);
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
    await this.presence.addOnlineUser(user.id, client.id);

    // Auto-join user's rooms
    const [roomIds, contactIds] = await Promise.all([
      this.chatService.getUserRoomIds(user.id),
      this.chatService.getUserContactIds(user.id),
    ]);
    await Promise.all(roomIds.map((roomId) => client.join(`room:${roomId}`)));

    // Broadcast online status — deduplicate so each user receives it once
    for (const contactId of contactIds) {
      const memberSockets = await this.presence.getOnlineSockets(contactId);
      for (const socketId of memberSockets) {
        this.server.to(socketId).emit('user-online', {
          userId: user.id,
          name: user.name,
          avatar: user.avatar,
        });
      }
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const user = client.data.user;
    if (!user) return;

    this.logger.log(
      `User ${user.name} (${user.id}) disconnected: ${client.id}`,
    );

    // Remove socket from tracking
    const remainingSockets = await this.presence.removeOnlineUser(user.id, client.id);
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
        const memberSockets = await this.presence.getOnlineSockets(member.id);
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
      const isMember = await this.chatService.isRoomMember(
        data.roomId,
        user.id,
      );
      if (!isMember) {
        throw new ForbiddenException('You are not a member of this room');
      }

      await client.join(`room:${data.roomId}`);

      // Notify room members
      this.server.to(`room:${data.roomId}`).emit('user-joined-room', {
        roomId: data.roomId,
        user: { id: user.id, name: user.name, avatar: user.avatar },
      });

      return { status: 'success', roomId: data.roomId };
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
      const roomName = await this.ensureSocketRoomMember(client, data.roomId);

      await client.leave(roomName);
      await this.chatService.leaveRoom(data.roomId, user.id);

      // Notify room members
      this.server.to(roomName).emit('user-left-room', {
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
    let timer: OperationTimer | undefined;
    try {
      const user = client.data.user!;
      timer = this.observability?.startOperation('chat.socket.send-message', {
        userId: user.id,
        roomId: data.roomId,
      });
      const message = await this.timeSocketStep(timer, 'db.saveMessage', () =>
        this.chatService.saveMessage(user.id, data),
      );

      // Broadcast to all room members
      this.server.to(`room:${data.roomId}`).emit('new-message', message);

      const recipientIds = (await this.timeSocketStep(timer, 'db.roomMembers', () =>
        this.chatService.getRoomMemberIds(data.roomId),
      ))
        .filter((memberId) => memberId !== user.id);
      const recipients = await this.timeSocketStep(timer, 'db.unreadCounts', () =>
        Promise.all(
          recipientIds.map(async (recipientId) => ({
            recipientId,
            unreadCount: await this.chatService.getUnreadCount(data.roomId, recipientId),
          })),
        ),
      );
      await this.timeSocketStep(timer, 'notifications.fanout', async () => {
        await this.notifications?.notifyChatMessageRecipients({
          senderId: user.id,
          recipients,
          roomId: data.roomId,
          messageId: message.id,
        });
      });
      timer?.end({ recipientCount: recipients.length, messageId: message.id });

      return { status: 'success', message };
    } catch (error) {
      timer?.fail(error);
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
  async handleTyping(
    @MessageBody() data: TypingDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const roomName = await this.ensureSocketRoomMember(client, data.roomId);

      // Broadcast to room except sender
      client.to(roomName).emit('user-typing', {
        roomId: data.roomId,
        userId: user.id,
        name: user.name,
        isTyping: data.isTyping,
      });

      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Typing error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to send typing status' };
    }
  }

  @SubscribeMessage('get-online-users')
  async handleGetOnlineUsers(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const user = client.data.user!;
      const contactIds = await this.chatService.getUserContactIds(user.id);
      const onlineUsers = await this.presence.getOnlineUserIds(contactIds);
      client.emit('online-users', onlineUsers);
      return { status: 'success', onlineUsers };
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

  private async ensureSocketRoomMember(
    client: AuthenticatedSocket,
    roomId: number,
  ): Promise<string> {
    const user = client.data.user;
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    const roomName = `room:${roomId}`;
    if (client.rooms.has(roomName)) {
      return roomName;
    }

    const isMember = await this.chatService.isRoomMember(roomId, user.id);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    await client.join(roomName);
    return roomName;
  }

  // ─── Error helper ───

  private getErrMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private timeSocketStep<T>(
    timer: OperationTimer | undefined,
    step: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return timer ? timer.time(step, callback) : callback();
  }

  // ─── Token extraction ───

}
