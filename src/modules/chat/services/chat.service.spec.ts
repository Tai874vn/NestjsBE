import { ChatService } from './chat.service';

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
});
