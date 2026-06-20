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
        getUserRoomIds: jest.fn().mockResolvedValue([]),
        getUserContactIds: jest.fn().mockResolvedValue([]),
        isRoomMember: jest.fn(),
        getMessages: jest.fn(),
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
    const { gateway, chatService } = createGateway();
    const client = {
      data: { user: { id: 6, name: 'Tai', avatar: null } },
      emit: jest.fn(),
    };
    chatService.getUserContactIds.mockResolvedValue([7]);
    await gateway['addOnlineUser'](7, 'socket-7');

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
});
