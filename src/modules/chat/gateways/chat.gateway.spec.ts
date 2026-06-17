import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ChatService } from '../services/chat.service';
import { PrismaService } from '../../../prisma.service';

describe('ChatGateway socket events', () => {
  const createGateway = () => {
    const gateway = new ChatGateway(
      {} as JwtService,
      {} as ConfigService,
      {} as PrismaService,
      {
        getUserRooms: jest.fn(),
        getUserRoomIds: jest.fn(),
      } as unknown as ChatService,
      null,
    );

    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as never;

    return {
      gateway,
      chatService: gateway['chatService'] as jest.Mocked<ChatService>,
    };
  };

  it('emits the frontend rooms event when a user connects', async () => {
    const { gateway, chatService } = createGateway();
    const client = {
      id: 'socket-1',
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      join: jest.fn(),
      emit: jest.fn(),
    };
    const rooms = [
      {
        id: 1,
        name: null,
        isPrivate: true,
        members: [{ id: 6, name: 'Tai', avatar: null }],
        unreadCount: 0,
        createdAt: new Date('2026-06-16T00:00:00.000Z'),
        updatedAt: new Date('2026-06-16T00:00:00.000Z'),
      },
    ];

    chatService.getUserRooms.mockResolvedValue(rooms);

    await gateway.handleConnection(client as never);

    expect(client.emit).toHaveBeenCalledWith('rooms', rooms);
    expect(client.emit).toHaveBeenCalledWith('rooms-list', rooms);
  });

  it('emits online-users when the frontend asks for online contacts', async () => {
    const { gateway, chatService } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      emit: jest.fn(),
    };
    const rooms = [
      {
        id: 1,
        name: null,
        isPrivate: true,
        members: [
          { id: 6, name: 'Tai', avatar: null },
          { id: 7, name: 'Lina', avatar: null },
        ],
        unreadCount: 0,
        createdAt: new Date('2026-06-16T00:00:00.000Z'),
        updatedAt: new Date('2026-06-16T00:00:00.000Z'),
      },
    ];

    chatService.getUserRooms.mockResolvedValue(rooms);
    await gateway['addOnlineUser'](7, 'socket-7');

    await expect(gateway.handleGetOnlineUsers(client as never)).resolves.toEqual({
      status: 'success',
      onlineUsers: [7],
    });
    expect(client.emit).toHaveBeenCalledWith('online-users', [7]);
  });
});
