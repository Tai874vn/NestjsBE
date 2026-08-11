import { ChatGateway } from './chat.gateway';
import { ChatService } from '../services/chat.service';
import { ChatPresenceService } from '../services/chat-presence.service';
import { ChatSocketAuthService } from '../services/chat-socket-auth.service';

describe('ChatGateway socket events', () => {
  const createGateway = () => {
    const getUserRooms = jest.fn();
    const getUserRoomIds = jest.fn().mockResolvedValue([]);
    const getUserContactIds = jest.fn().mockResolvedValue([]);
    const isRoomMember = jest.fn();
    const getMessages = jest.fn();
    const leaveRoom = jest.fn();
    const chatService = {
      getUserRooms,
      getUserRoomIds,
      getUserContactIds,
      isRoomMember,
      getMessages,
      leaveRoom,
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
    const gateway = new ChatGateway(chatService, socketAuth, presence);
    const serverTo = jest.fn().mockReturnValue({ emit: jest.fn() });

    gateway.server = {
      to: serverTo,
    } as never;

    return {
      gateway,
      chatService,
      chatMocks: {
        getUserRooms,
        getUserRoomIds,
        getUserContactIds,
        isRoomMember,
        getMessages,
        leaveRoom,
      },
      presence,
      socketAuth,
      serverTo,
    };
  };

  it('joins room IDs without loading or emitting room responses', async () => {
    const { gateway, chatMocks } = createGateway();
    const join = jest.fn();
    const emit = jest.fn();
    const client = {
      id: 'socket-1',
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      join,
      emit,
    };
    chatMocks.getUserRoomIds.mockResolvedValue([1, 2]);

    await gateway.handleConnection(client as never);

    expect(chatMocks.getUserRooms).not.toHaveBeenCalled();
    expect(join).toHaveBeenCalledTimes(2);
    expect(join).toHaveBeenNthCalledWith(1, 'room:1');
    expect(join).toHaveBeenNthCalledWith(2, 'room:2');
    expect(emit).not.toHaveBeenCalledWith('rooms', expect.anything());
    expect(emit).not.toHaveBeenCalledWith('rooms-list', expect.anything());
  });

  it('emits online-users when the frontend asks for online contacts', async () => {
    const { gateway, chatMocks, presence } = createGateway();
    const emit = jest.fn();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      emit,
    };
    chatMocks.getUserContactIds.mockResolvedValue([7]);
    presence.getOnlineUserIds.mockResolvedValue([7]);

    await expect(gateway.handleGetOnlineUsers(client as never)).resolves.toEqual({
      status: 'success',
      onlineUsers: [7],
    });
    expect(chatMocks.getUserRooms).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('online-users', [7]);
  });

  it('joins an authorized room without loading message history', async () => {
    const { gateway, chatMocks } = createGateway();
    const join = jest.fn();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      join,
    };
    chatMocks.isRoomMember.mockResolvedValue(true);

    await expect(
      gateway.handleJoinRoom({ roomId: 9 }, client as never),
    ).resolves.toEqual({ status: 'success', roomId: 9 });

    expect(join).toHaveBeenCalledWith('room:9');
    expect(chatMocks.getMessages).not.toHaveBeenCalled();
  });

  it('does not broadcast typing events for sockets outside a room', async () => {
    const { gateway, chatMocks } = createGateway();
    const emit = jest.fn();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      rooms: new Set(['socket-1']),
      join: jest.fn(),
      to: jest.fn().mockReturnValue({ emit }),
    };
    chatMocks.isRoomMember.mockResolvedValue(false);

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
    const { gateway, chatMocks, serverTo } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      rooms: new Set(['socket-1']),
      join: jest.fn(),
      leave: jest.fn(),
    };
    chatMocks.isRoomMember.mockResolvedValue(false);

    await expect(
      gateway.handleLeaveRoom({ roomId: 9 }, client as never),
    ).resolves.toEqual({
      status: 'error',
      message: 'Failed to leave room',
    });

    expect(chatMocks.leaveRoom).not.toHaveBeenCalled();
    expect(serverTo).not.toHaveBeenCalled();
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
