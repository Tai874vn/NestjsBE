import { ChatGateway } from './chat.gateway';
import { ChatService } from '../services/chat.service';
import { ChatPresenceService } from '../services/chat-presence.service';
import { ChatSocketAuthService } from '../services/chat-socket-auth.service';
import { UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedSocket } from '../services/authenticated-socket.type';

jest.mock('../../auth/session/auth-session.service', () => ({
  AuthSessionService: class {},
}));

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
    const addOnlineUser = jest.fn().mockResolvedValue(undefined);
    const getOnlineSockets = jest.fn().mockResolvedValue([]);
    const removeOnlineUser = jest.fn().mockResolvedValue(0);
    const presence = {
      logMode: jest.fn(),
      addOnlineUser,
      getOnlineSockets,
      removeOnlineUser,
      getOnlineUserIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ChatPresenceService>;
    const socketAuth = {
      authenticateSocket: jest.fn(),
    } as unknown as jest.Mocked<ChatSocketAuthService>;
    const listeners = new Set<(sid: string) => void>();
    const unsubscribe = jest.fn(() => listeners.clear());
    const sessions = {
      assertAccessSession: jest.fn().mockResolvedValue(undefined),
      onRevoked: (listener: (sid: string) => void) => {
        listeners.add(listener);
        return unsubscribe;
      },
    };
    const gateway = new ChatGateway(
      chatService,
      socketAuth,
      presence,
      sessions as never,
    );
    const serverTo = jest.fn().mockReturnValue({ emit: jest.fn() });
    const disconnectSockets = jest.fn();
    const sessionRoom = jest.fn().mockReturnValue({ disconnectSockets });

    gateway.server = {
      to: serverTo,
      use: jest.fn(),
      local: { in: sessionRoom },
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
      addOnlineUser,
      getOnlineSockets,
      removeOnlineUser,
      sessions,
      socketAuth,
      serverTo,
      sessionRoom,
      disconnectSockets,
      revoke: (sid: string) => listeners.forEach((listener) => listener(sid)),
      unsubscribe,
    };
  };

  it('broadcasts a server-made message as new-message to its room', () => {
    const { gateway, serverTo } = createGateway();
    const message = { id: 5, roomId: 12, content: 'Hello' };

    gateway.broadcastNewMessage(12, message);

    expect(serverTo).toHaveBeenCalledWith('room:12');
    const emit = (serverTo.mock.results[0].value as { emit: jest.Mock }).emit;
    expect(emit).toHaveBeenCalledWith('new-message', message);
  });

  it('joins room IDs without loading or emitting room responses', async () => {
    const { gateway, chatMocks } = createGateway();
    const join = jest.fn();
    const emit = jest.fn();
    const client = {
      id: 'socket-1',
      connected: true,
      data: {
        user: { id: 6, name: 'Tai', avatar: null },
        sessionId: 'session-6',
        jti: 'ticket-6',
      },
      join,
      emit,
    };
    chatMocks.getUserRoomIds.mockResolvedValue([1, 2]);

    await gateway.handleConnection(client as never);

    expect(chatMocks.getUserRooms).not.toHaveBeenCalled();
    expect(join).toHaveBeenCalledTimes(3);
    expect(join).toHaveBeenNthCalledWith(1, 'auth-session:session-6');
    expect(join).toHaveBeenNthCalledWith(2, 'room:1');
    expect(join).toHaveBeenNthCalledWith(3, 'room:2');
    expect(emit).not.toHaveBeenCalledWith('rooms', expect.anything());
    expect(emit).not.toHaveBeenCalledWith('rooms-list', expect.anything());
    gateway.onModuleDestroy();
  });

  it('rejects a connection without its authenticated session before tracking presence', async () => {
    const { gateway, addOnlineUser } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(addOnlineUser).not.toHaveBeenCalled();
  });

  it('disconnects only the revoked session room using local sockets', () => {
    const { gateway, sessionRoom, disconnectSockets, serverTo, revoke } =
      createGateway();
    gateway.afterInit(gateway.server);

    revoke('session-6');

    expect(sessionRoom).toHaveBeenCalledWith('auth-session:session-6');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
    expect(serverTo).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it('unsubscribes from session revocations on module destruction', () => {
    const { gateway, revoke, sessionRoom, unsubscribe } = createGateway();
    gateway.afterInit(gateway.server);

    gateway.onModuleDestroy();
    revoke('session-6');

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(sessionRoom).not.toHaveBeenCalled();
  });

  const connectedClient = () => {
    const client = {
      id: 'socket-1',
      connected: true,
      data: {
        user: { id: 6, name: 'Tai', avatar: null },
        sessionId: 'session-6',
        jti: 'ticket-6',
      },
      join: jest.fn(),
      disconnect: jest.fn(() => {
        client.connected = false;
      }),
    };
    return client;
  };

  it('disconnects a session revoked while the handshake user lookup is pending', async () => {
    const { gateway, sessions, revoke, addOnlineUser, chatMocks, serverTo } =
      createGateway();
    const client = {
      ...connectedClient(),
      data: {} as AuthenticatedSocket['data'],
      handshake: { auth: { token: 'ticket' }, headers: {} },
    };
    client.disconnect.mockImplementation(() => {
      client.connected = false;
    });
    let releaseLookup!: (user: {
      id: number;
      name: string;
      avatar: null;
    }) => void;
    const lookup = new Promise((resolve) => {
      releaseLookup = resolve;
    });
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const prisma = {
      user: {
        findUnique: jest.fn(() => {
          markLookupStarted();
          return lookup;
        }),
      },
    };
    let revoked = false;
    sessions.assertAccessSession.mockImplementation(() =>
      revoked ? Promise.reject(new UnauthorizedException()) : Promise.resolve(),
    );
    const auth = new ChatSocketAuthService(
      {
        verify: () => ({
          sub: 6,
          sid: 'session-6',
          jti: 'ticket-6',
          type: 'socket',
        }),
      } as never,
      { get: () => 'secret' } as never,
      prisma as never,
      sessions as never,
    );
    gateway.afterInit(gateway.server);
    const next = jest.fn();
    const handshake = auth.authenticateSocket(client as never, next);
    await lookupStarted;

    revoked = true;
    revoke('session-6');
    expect(client.join).not.toHaveBeenCalled();
    releaseLookup({ id: 6, name: 'Tai', avatar: null });
    await handshake;
    expect(next).toHaveBeenCalledWith();

    await expect(
      gateway.handleConnection(client as never),
    ).resolves.toBeUndefined();

    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join.mock.calls).toEqual([['auth-session:session-6']]);
    expect(sessions.assertAccessSession).toHaveBeenNthCalledWith(
      2,
      'session-6',
      6,
      'ticket-6',
    );
    expect(addOnlineUser).not.toHaveBeenCalled();
    expect(chatMocks.getUserRoomIds).not.toHaveBeenCalled();
    expect(serverTo).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it('checks the session after joining its revocation room and before presence', async () => {
    const { gateway, sessions, addOnlineUser } = createGateway();
    const client = connectedClient();
    const order: string[] = [];
    client.join.mockImplementation((room: string) => {
      order.push(room);
    });
    sessions.assertAccessSession.mockImplementation(() => {
      order.push('assert-session');
      return Promise.resolve();
    });
    addOnlineUser.mockImplementation(() => {
      order.push('presence');
      return Promise.resolve();
    });

    await gateway.handleConnection(client as never);

    expect(order).toEqual([
      'auth-session:session-6',
      'assert-session',
      'presence',
    ]);
    expect(sessions.assertAccessSession).toHaveBeenCalledWith(
      'session-6',
      6,
      'ticket-6',
    );
    gateway.onModuleDestroy();
  });

  it.each(['already disconnected', 'session room join', 'session recheck'])(
    'stops connection setup after disconnect at %s',
    async (stage) => {
      const { gateway, sessions, addOnlineUser } = createGateway();
      const client = connectedClient();
      if (stage === 'already disconnected') client.connected = false;
      if (stage === 'session room join')
        client.join.mockImplementation(() => {
          client.connected = false;
        });
      if (stage === 'session recheck')
        sessions.assertAccessSession.mockImplementation(() => {
          client.connected = false;
          return Promise.resolve();
        });

      await gateway.handleConnection(client as never);

      expect(addOnlineUser).not.toHaveBeenCalled();
      if (stage === 'already disconnected')
        expect(client.join).not.toHaveBeenCalled();
      else expect(client.join.mock.calls).toEqual([['auth-session:session-6']]);
      gateway.onModuleDestroy();
    },
  );

  it('removes late presence registration if the socket disconnected during the write', async () => {
    const { gateway, addOnlineUser, removeOnlineUser, chatMocks } =
      createGateway();
    const client = connectedClient();
    addOnlineUser.mockImplementation(() => {
      client.connected = false;
      return Promise.resolve();
    });

    await gateway.handleConnection(client as never);

    expect(removeOnlineUser).toHaveBeenCalledWith(6, 'socket-1');
    expect(chatMocks.getUserRoomIds).not.toHaveBeenCalled();
    expect(client.join.mock.calls).toEqual([['auth-session:session-6']]);
    gateway.onModuleDestroy();
  });

  it('does not remove presence or broadcast offline for a rejected connection that was never registered', async () => {
    const { gateway, sessions, removeOnlineUser, chatMocks, serverTo } =
      createGateway();
    const client = connectedClient();
    sessions.assertAccessSession.mockRejectedValue(new UnauthorizedException());

    await gateway.handleConnection(client as never);
    await gateway.handleDisconnect(client as never);

    expect(removeOnlineUser).not.toHaveBeenCalled();
    expect(chatMocks.getUserRoomIds).not.toHaveBeenCalled();
    expect(serverTo).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it.each(['room lookup', 'private room join', 'contact socket lookup'])(
    'does not continue private joins or events after disconnect during %s',
    async (stage) => {
      const { gateway, chatMocks, getOnlineSockets, serverTo } =
        createGateway();
      const client = connectedClient();
      chatMocks.getUserRoomIds.mockResolvedValue([1, 2]);
      chatMocks.getUserContactIds.mockResolvedValue([7]);
      if (stage === 'room lookup')
        chatMocks.getUserRoomIds.mockImplementation(() => {
          client.connected = false;
          return Promise.resolve([1, 2]);
        });
      if (stage === 'private room join')
        client.join.mockImplementation((room: string) => {
          if (room === 'room:1') client.connected = false;
        });
      getOnlineSockets.mockImplementation(() => {
        if (stage === 'contact socket lookup') client.connected = false;
        return Promise.resolve(['contact-socket']);
      });

      await gateway.handleConnection(client as never);

      expect(serverTo).not.toHaveBeenCalled();
      if (stage === 'room lookup')
        expect(client.join.mock.calls).toEqual([['auth-session:session-6']]);
      if (stage === 'private room join')
        expect(client.join.mock.calls).toEqual([
          ['auth-session:session-6'],
          ['room:1'],
        ]);
      gateway.onModuleDestroy();
    },
  );

  it('emits online-users when the frontend asks for online contacts', async () => {
    const { gateway, chatMocks, presence } = createGateway();
    const emit = jest.fn();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      emit,
    };
    chatMocks.getUserContactIds.mockResolvedValue([7]);
    presence.getOnlineUserIds.mockResolvedValue([7]);

    await expect(
      gateway.handleGetOnlineUsers(client as never),
    ).resolves.toEqual({
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
    const authService = new ChatSocketAuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
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
    const authService = new ChatSocketAuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
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
