import { ChatGateway } from './chat.gateway';
import { ChatService } from '../services/chat.service';
import { ChatPresenceService } from '../services/chat-presence.service';
import { ChatSocketAuthService } from '../services/chat-socket-auth.service';

describe('ChatGateway socket events', () => {
  const createGateway = () => {
    const chatService = {
      getUserRooms: jest.fn(),
      getUserRoomIds: jest.fn().mockResolvedValue([]),
      getUserContactIds: jest.fn().mockResolvedValue([]),
      isRoomMember: jest.fn(),
      getMessages: jest.fn(),
      leaveRoom: jest.fn(),
    } as unknown as jest.Mocked<ChatService>;
    const presence = {
      logMode: jest.fn(),
      addOnlineUser: jest.fn().mockResolvedValue(undefined),
      getOnlineSockets: jest.fn().mockResolvedValue([]),
      removeOnlineUser: jest.fn().mockResolvedValue(0),
      getOnlineUserIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ChatPresenceService>;
    const socketAuth = {
      authenticateSocket: jest.fn(),
    } as unknown as jest.Mocked<ChatSocketAuthService>;
    const gateway = new ChatGateway(
      chatService,
      socketAuth,
      presence,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as never;

    return {
      gateway,
      chatService,
      presence,
      socketAuth,
    };
  };

  it('joins room IDs without loading or emitting room responses', async () => {
    const { gateway, chatService } = createGateway();
    const client = {
      id: 'socket-1',
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      join: jest.fn(),
      emit: jest.fn(),
    };
    chatService.getUserRoomIds.mockResolvedValue([1, 2]);

    await gateway.handleConnection(client as never);

    expect(chatService.getUserRooms).not.toHaveBeenCalled();
    expect(client.join).toHaveBeenCalledTimes(2);
    expect(client.join).toHaveBeenNthCalledWith(1, 'room:1');
    expect(client.join).toHaveBeenNthCalledWith(2, 'room:2');
    expect(client.emit).not.toHaveBeenCalledWith('rooms', expect.anything());
    expect(client.emit).not.toHaveBeenCalledWith(
      'rooms-list',
      expect.anything(),
    );
  });

  it('emits online-users when the frontend asks for online contacts', async () => {
    const { gateway, chatService, presence } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      emit: jest.fn(),
    };
    chatService.getUserContactIds.mockResolvedValue([7]);
    presence.getOnlineUserIds.mockResolvedValue([7]);

    await expect(gateway.handleGetOnlineUsers(client as never)).resolves.toEqual({
      status: 'success',
      onlineUsers: [7],
    });
    expect(chatService.getUserRooms).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('online-users', [7]);
  });

  it('joins an authorized room without loading message history', async () => {
    const { gateway, chatService } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      join: jest.fn(),
    };
    chatService.isRoomMember.mockResolvedValue(true);

    await expect(
      gateway.handleJoinRoom({ roomId: 9 }, client as never),
    ).resolves.toEqual({ status: 'success', roomId: 9 });

    expect(client.join).toHaveBeenCalledWith('room:9');
    expect(chatService.getMessages).not.toHaveBeenCalled();
  });

  it('does not broadcast typing events for sockets outside a room', async () => {
    const { gateway, chatService } = createGateway();
    const emit = jest.fn();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      rooms: new Set(['socket-1']),
      join: jest.fn(),
      to: jest.fn().mockReturnValue({ emit }),
    };
    chatService.isRoomMember.mockResolvedValue(false);

    await expect(
      gateway.handleTyping({ roomId: 9, isTyping: true }, client as never),
    ).resolves.toEqual({
      status: 'error',
      message: 'Failed to send typing status',
    });

    expect(client.to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not emit leave-room events for non-members', async () => {
    const { gateway, chatService } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      rooms: new Set(['socket-1']),
      join: jest.fn(),
      leave: jest.fn(),
    };
    chatService.isRoomMember.mockResolvedValue(false);

    await expect(
      gateway.handleLeaveRoom({ roomId: 9 }, client as never),
    ).resolves.toEqual({
      status: 'error',
      message: 'Failed to leave room',
    });

    expect(chatService.leaveRoom).not.toHaveBeenCalled();
    expect(gateway.server.to).not.toHaveBeenCalled();
  });

  it('does not accept access tokens from socket query strings', () => {
    const authService = new ChatSocketAuthService({} as never, {} as never, {} as never);
    const socket = {
      handshake: {
        auth: {},
        headers: {},
        query: { token: 'query-token' },
      },
    };

    expect(authService.extractToken(socket as never)).toBeNull();
  });

  it('accepts cookie tokens for socket authentication', () => {
    const authService = new ChatSocketAuthService({} as never, {} as never, {} as never);
    const socket = {
      handshake: {
        auth: {},
        headers: { cookie: 'theme=light; access_token=cookie%2Etoken' },
        query: {},
      },
    };

    expect(authService.extractToken(socket as never)).toBe('cookie.token');
  });
});
