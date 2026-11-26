import { trustedOrigins } from '../../../config/trusted-origins';
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
  OnModuleDestroy,
} from '@nestjs/common';
import { AuthSessionService } from '../../auth/session/auth-session.service';
import {
  ObservabilityService,
  OperationTimer,
} from '../../../common/observability/observability.service';
import { ChatService } from '../services/chat.service';
import { ChatMessageFanoutService } from '../services/chat-message-fanout.service';
import { ChatPresenceService } from '../services/chat-presence.service';
import { ChatSocketAuthService } from '../services/chat-socket-auth.service';
import { ChatSocketRateLimitService } from '../services/chat-socket-rate-limit.service';
import type { AuthenticatedSocket } from '../utils/authenticated-socket.type';
import {
  SendMessageDto,
  GetMessagesDto,
  JoinRoomDto,
  TypingDto,
  CreateRoomDto,
  MarkAsReadDto,
} from '../dto/chat.dto';

/**
 * REAL-TIME CHAT. A gateway is the WebSocket version of a controller: instead of answering web requests,
 * it reacts to named events the browser sends ("send-message", "typing", …) and can push events back
 * ("new-message", "user-online", …) at any time.
 *
 * The flow:
 *  1. Connect: the browser opens a Socket.IO connection to /chat. Before it is accepted,
 *     ChatSocketAuthService checks the login token (same JWT as the website) — see afterInit.
 *  2. handleConnection: mark the user online (in Redis), join a Socket.IO "room" for each chat they are in
 *     (a room = a named group of connections; sending to `room:5` reaches everyone in chat 5), and tell
 *     their contacts "this user is online".
 *  3. send-message: check the rate limit (at most 20 messages a minute), save the message in the database
 *     (only if the sender is a member of the chat), create notifications for the others, then push
 *     "new-message" to everyone in the room.
 *  4. Logout or ban anywhere → the session is revoked → onRevoked disconnects that session's sockets here.
 *  5. handleDisconnect: remove the user from the online list and tell the others "offline".
 *
 * With two or more backend copies, RedisIoAdapter (common/adapters/redis-io.adapter.ts) makes
 * `server.to(room).emit(...)` reach users connected to the other copies too.
 * cors = which website may connect (only our frontend). ValidationPipe checks every event's data shape.
 */
@WebSocketGateway({
  cors: {
    origin: trustedOrigins(),
    credentials: true,
  },
  namespace: '/chat',
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('ChatGateway');
  private readonly presenceRefreshTimers = new Map<string, NodeJS.Timeout>();
  private unsubscribeRevoked?: () => void;

  constructor(
    private readonly chatService: ChatService,
    private readonly socketAuth: ChatSocketAuthService,
    private readonly presence: ChatPresenceService,
    private readonly sessions: AuthSessionService,
    @Optional()
    private readonly messageFanout?: ChatMessageFanoutService,
    @Optional()
    private readonly observability?: ObservabilityService,
    @Optional()
    private readonly rateLimit?: ChatSocketRateLimitService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');

    this.presence.logMode();

    this.unsubscribeRevoked?.();
    this.unsubscribeRevoked = this.sessions.onRevoked((sid) => {
      server.local.in(`auth-session:${sid}`).disconnectSockets(true);
    });

    // Authentication middleware (a function that runs before a connection is accepted):
    // no valid token → the connection is refused.
    server.use((socket: AuthenticatedSocket, next) => {
      void this.socketAuth.authenticateSocket(socket, next);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribeRevoked?.();
    this.unsubscribeRevoked = undefined;
    for (const timer of this.presenceRefreshTimers.values())
      clearInterval(timer);
    this.presenceRefreshTimers.clear();
  }

  // The many `if (!client.connected) return;` lines: every `await` is a pause, and the user may close the
  // tab during it. We stop as soon as the connection is gone, so we never mark a closed tab as online.
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

      this.logger.log(`User ${user.name} (${user.id}) connected: ${client.id}`);

      // Track online status
      await this.presence.addOnlineUser(user.id, client.id);
      if (!client.connected) {
        await this.presence.removeOnlineUser(user.id, client.id);
        return;
      }
      client.data.presenceRegistered = true;
      this.startPresenceRefresh(client.id, user.id);

      // Auto-join user's rooms
      const [roomIds, contactIds] = await Promise.all([
        this.chatService.getUserRoomIds(user.id),
        this.chatService.getUserContactIds(user.id),
      ]);
      if (!client.connected) return;
      for (const roomId of roomIds) {
        await client.join(`room:${roomId}`);
        if (!client.connected) return;
      }

      // Broadcast online status once per online contact.
      for (const contactId of contactIds) {
        const memberSockets = await this.presence.getOnlineSockets(contactId);
        if (!client.connected) return;
        for (const socketId of memberSockets) {
          this.server.to(socketId).emit('user-online', {
            userId: user.id,
            name: user.name,
            avatar: user.avatar,
          });
        }
      }
    } catch (error) {
      this.logger.error(`Connection error: ${this.getErrMsg(error)}`);
      this.stopPresenceRefresh(client.id);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const user = client.data.user;
    if (!user || !client.data.presenceRegistered) return;
    client.data.presenceRegistered = false;

    this.stopPresenceRefresh(client.id);

    this.logger.log(
      `User ${user.name} (${user.id}) disconnected: ${client.id}`,
    );

    // Remove socket from tracking
    const remainingSockets = await this.presence.removeOnlineUser(
      user.id,
      client.id,
    );
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

  private startPresenceRefresh(socketId: string, userId: number): void {
    this.stopPresenceRefresh(socketId);
    const timer = setInterval(
      () => {
        void this.presence.refreshOnlineUser(userId);
      },
      20 * 60 * 1000,
    );
    timer.unref();
    this.presenceRefreshTimers.set(socketId, timer);
  }

  private stopPresenceRefresh(socketId: string): void {
    const timer = this.presenceRefreshTimers.get(socketId);
    if (timer) clearInterval(timer);
    this.presenceRefreshTimers.delete(socketId);
  }

  @SubscribeMessage('create-room')
  async handleCreateRoom(
    @MessageBody() data: CreateRoomDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const limited = await this.checkRateLimit(
        client,
        'create-room',
        10,
        60_000,
      );
      if (limited) return limited;
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
      const limited = await this.checkRateLimit(
        client,
        'join-room',
        60,
        60_000,
      );
      if (limited) return limited;
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
      const limited = await this.checkRateLimit(
        client,
        'leave-room',
        30,
        60_000,
      );
      if (limited) return limited;
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

  /**
   * The browser sent "send-message" { roomId, content }.
   * @SubscribeMessage = "run this function when this event arrives".
   * Save → notify the other members → push "new-message" to the whole room (the sender too, so all
   * their open tabs update). The return value is the acknowledgement (the answer to the sender only).
   */
  @SubscribeMessage('send-message')
  async handleMessage(
    @MessageBody() data: SendMessageDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    let timer: OperationTimer | undefined;
    try {
      const user = client.data.user!;
      const limited = await this.checkRateLimit(
        client,
        'send-message',
        20,
        60_000,
      );
      if (limited) return limited;
      timer = this.observability?.startOperation('chat.socket.send-message', {
        userId: user.id,
        roomId: data.roomId,
      });
      const { message, recipientCount } = this.messageFanout
        ? await this.messageFanout.saveMessageAndNotify(user.id, data, timer)
        : {
            message: await this.timeSocketStep(timer, 'db.saveMessage', () =>
              this.chatService.saveMessage(user.id, data),
            ),
            recipientCount: 0,
          };

      // Broadcast to all room members
      this.server.to(`room:${data.roomId}`).emit('new-message', message);
      timer?.end({ recipientCount, messageId: message.id });

      return { status: 'success', message };
    } catch (error) {
      timer?.fail(error);
      this.logger.error(`Send message error: ${this.getErrMsg(error)}`);
      return { status: 'error', message: 'Failed to send message' };
    }
  }

  /**
   * Push "new-message" to everyone in the room for a message the server made itself
   * (for example the hiring pipeline's interview request). It does the same as the last
   * step of handleMessage, so the open chat windows update at once.
   */
  broadcastNewMessage(roomId: number, message: unknown): void {
    this.server.to(`room:${roomId}`).emit('new-message', message);
  }

  @SubscribeMessage('get-messages')
  async handleGetMessages(
    @MessageBody() data: GetMessagesDto,
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    try {
      const user = client.data.user!;
      const limited = await this.checkRateLimit(
        client,
        'get-messages',
        60,
        60_000,
      );
      if (limited) return limited;
      const messages = await this.chatService.getMessages(user.id, {
        roomId: data.roomId,
        limit: data.limit ?? 50,
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
      const limited = await this.checkRateLimit(
        client,
        'mark-as-read',
        60,
        60_000,
      );
      if (limited) return limited;
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
      const limited = await this.checkRateLimit(client, 'typing', 40, 10_000);
      if (limited) return limited;
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
      const limited = await this.checkRateLimit(
        client,
        'get-online-users',
        30,
        30_000,
      );
      if (limited) return limited;
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
      const limited = await this.checkRateLimit(
        client,
        'get-rooms',
        30,
        30_000,
      );
      if (limited) return limited;
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

  private async checkRateLimit(
    client: AuthenticatedSocket,
    event: string,
    limit: number,
    windowMs: number,
  ) {
    const user = client.data.user;
    if (!user || !this.rateLimit) return null;

    const result = await this.rateLimit.consume(
      user.id,
      event,
      limit,
      windowMs,
    );
    if (result.allowed) return null;

    const payload = {
      event,
      retryAfterMs: result.retryAfterMs,
    };
    client.emit('rate-limited', payload);
    return {
      status: 'error',
      message: 'Too many chat requests. Please slow down.',
      ...payload,
    };
  }

  // ─── Token extraction ───
}
