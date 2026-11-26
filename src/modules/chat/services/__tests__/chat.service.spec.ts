import { BadRequestException } from '@nestjs/common';
import { ChatService } from '../chat.service';

describe('ChatService query behavior', () => {
  it('loads unread counts for every room with one aggregate query', async () => {
    const rooms = [1, 2, 3].map((id) => ({
      id,
      name: null,
      isPrivate: true,
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
      updatedAt: new Date('2026-06-19T00:00:00.000Z'),
      members: [
        {
          userId: 6,
          user: { id: 6, name: 'Tai', avatar: null },
        },
      ],
      messages: [],
    }));
    const prisma = {
      chatRoom: { findMany: jest.fn().mockResolvedValue(rooms) },
      chatRoomMember: {
        findMany: jest.fn().mockResolvedValue(
          rooms.map((room) => ({
            roomId: room.id,
            lastReadAt: new Date('2026-06-19T00:00:00.000Z'),
          })),
        ),
      },
      chatMessage: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([
        { roomId: 1, count: 2n },
        { roomId: 3, count: 1n },
      ]),
    };
    const service = new ChatService(prisma as never);

    const result = await service.getUserRooms(6);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.chatMessage.count).not.toHaveBeenCalled();
    expect(result.map((room) => room.unreadCount)).toEqual([2, 0, 1]);
  });

  it('rejects room creation when any member does not exist', async () => {
    const prisma = {
      user: { count: jest.fn().mockResolvedValue(1) },
      chatRoom: { create: jest.fn() },
    };
    const service = new ChatService(prisma as never);

    await expect(
      service.createRoom(6, { memberIds: [99], isPrivate: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.chatRoom.create).not.toHaveBeenCalled();
  });

  it('trims message content before saving', async () => {
    const prisma = {
      chatRoomMember: {
        findUnique: jest.fn().mockResolvedValue({ roomId: 4, userId: 6 }),
      },
      chatMessage: {
        create: jest.fn().mockResolvedValue({
          id: 9,
          roomId: 4,
          content: 'Hello',
          createdAt: new Date('2026-06-19T00:00:00.000Z'),
          sender: { id: 6, name: 'Tai', avatar: null },
        }),
      },
      chatRoom: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    const service = new ChatService(prisma as never);

    await service.saveMessage(6, { roomId: 4, content: '  Hello  ' });

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'Hello' }),
      }),
    );
  });
});
