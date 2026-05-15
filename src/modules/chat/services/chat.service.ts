import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import {
  CreateRoomDto,
  SendMessageDto,
  GetMessagesDto,
  MessageResponse,
  RoomResponse,
} from '../dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async createRoom(
    creatorId: number,
    createRoomDto: CreateRoomDto,
  ): Promise<RoomResponse> {
    const { name, memberIds, isPrivate = true } = createRoomDto;

    // Ensure creator is included in members
    const allMemberIds = [...new Set([creatorId, ...memberIds])];

    // For private 1-on-1 chat, check if room already exists
    if (isPrivate && allMemberIds.length === 2) {
      const existingRoom = await this.findPrivateRoom(
        allMemberIds[0],
        allMemberIds[1],
      );
      if (existingRoom) {
        return this.formatRoomResponse(existingRoom);
      }
    }

    const room = await this.prisma.chatRoom.create({
      data: {
        name,
        isPrivate,
        creatorId,
        members: {
          create: allMemberIds.map((userId) => ({ userId })),
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
      },
    });

    return this.formatRoomResponse(room);
  }

  async findPrivateRoom(userId1: number, userId2: number) {
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        isPrivate: true,
        members: {
          every: {
            userId: { in: [userId1, userId2] },
          },
        },
        AND: [
          { members: { some: { userId: userId1 } } },
          { members: { some: { userId: userId2 } } },
        ],
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            sender: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
      },
    });

    return room;
  }

  async getUserRoomIds(userId: number): Promise<number[]> {
    const members = await this.prisma.chatRoomMember.findMany({
      where: { userId },
      select: { roomId: true },
    });
    return members.map((m) => m.roomId);
  }

  async getUserRooms(userId: number): Promise<RoomResponse[]> {
    const rooms = await this.prisma.chatRoom.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            sender: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Batch unread counts in a single query
    const unreadCounts = await this.getBatchUnreadCounts(
      userId,
      rooms.map((r) => r.id),
    );

    return rooms.map((room) =>
      this.formatRoomResponse(room, unreadCounts.get(room.id) ?? 0),
    );
  }

  private async getBatchUnreadCounts(
    userId: number,
    roomIds: number[],
  ): Promise<Map<number, number>> {
    if (roomIds.length === 0) return new Map();

    const members = await this.prisma.chatRoomMember.findMany({
      where: { userId, roomId: { in: roomIds } },
      select: { roomId: true, lastReadAt: true },
    });

    const counts = await Promise.all(
      members.map(async (m) => {
        const count = await this.prisma.chatMessage.count({
          where: {
            roomId: m.roomId,
            createdAt: { gt: m.lastReadAt },
            senderId: { not: userId },
          },
        });
        return { roomId: m.roomId, count };
      }),
    );

    return new Map(counts.map((c) => [c.roomId, c.count]));
  }

  async getRoom(roomId: number, userId: number): Promise<RoomResponse> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            sender: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Check if user is a member
    const isMember = room.members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const unreadCount = await this.getUnreadCount(roomId, userId);
    return this.formatRoomResponse(room, unreadCount);
  }

  async isRoomMember(roomId: number, userId: number): Promise<boolean> {
    const member = await this.prisma.chatRoomMember.findUnique({
      where: {
        roomId_userId: { roomId, userId },
      },
    });
    return !!member;
  }

  async saveMessage(
    senderId: number,
    messageDto: SendMessageDto,
  ): Promise<MessageResponse> {
    const { roomId, content } = messageDto;

    // Verify sender is a member of the room
    const isMember = await this.isRoomMember(roomId, senderId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        roomId,
        senderId,
        content,
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Update room's updatedAt timestamp
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() },
    });

    return this.formatMessageResponse(message);
  }

  async getMessages(
    userId: number,
    getMessagesDto: GetMessagesDto,
  ): Promise<MessageResponse[]> {
    const { roomId, limit = 50, before } = getMessagesDto;

    // Verify user is a member
    const isMember = await this.isRoomMember(roomId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        roomId,
        ...(before ? { id: { lt: before } } : {}),
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true },
        },
      },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return messages.map((msg) => this.formatMessageResponse(msg)).reverse();
  }

  async addMemberToRoom(
    roomId: number,
    userId: number,
    addedBy: number,
  ): Promise<void> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Check if addedBy is a member
    const isMember = await this.isRoomMember(roomId, addedBy);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    // Check if user is already a member
    const alreadyMember = await this.isRoomMember(roomId, userId);
    if (alreadyMember) {
      return; // Already a member, no action needed
    }

    await this.prisma.chatRoomMember.create({
      data: { roomId, userId },
    });
  }

  async markAsRead(roomId: number, userId: number): Promise<boolean> {
    const result = await this.prisma.chatRoomMember.updateMany({
      where: { roomId, userId },
      data: { lastReadAt: new Date() },
    });
    return result.count > 0;
  }

  async getUnreadCount(roomId: number, userId: number): Promise<number> {
    const member = await this.prisma.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!member) return 0;

    return this.prisma.chatMessage.count({
      where: {
        roomId,
        createdAt: { gt: member.lastReadAt },
        senderId: { not: userId },
      },
    });
  }

  async leaveRoom(roomId: number, userId: number): Promise<void> {
    await this.prisma.chatRoomMember.deleteMany({
      where: { roomId, userId },
    });

    // If no members left, delete the room
    const remainingMembers = await this.prisma.chatRoomMember.count({
      where: { roomId },
    });

    if (remainingMembers === 0) {
      await this.prisma.chatRoom.delete({
        where: { id: roomId },
      });
    }
  }

  private formatRoomResponse(room: any, unreadCount = 0): RoomResponse {
    return {
      id: room.id,
      name: room.name,
      isPrivate: room.isPrivate,
      members: room.members.map((m: any) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
      })),
      lastMessage: room.messages?.[0]
        ? this.formatMessageResponse(room.messages[0])
        : undefined,
      unreadCount,
      updatedAt: room.updatedAt,
      createdAt: room.createdAt,
    };
  }

  private formatMessageResponse(message: any): MessageResponse {
    return {
      id: message.id,
      content: message.content,
      roomId: message.roomId,
      sender: {
        id: message.sender.id,
        name: message.sender.name,
        avatar: message.sender.avatar,
      },
      createdAt: message.createdAt,
    };
  }
}
