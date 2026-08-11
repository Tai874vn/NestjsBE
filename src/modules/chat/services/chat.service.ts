import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import {
  CreateRoomDto,
  SendMessageDto,
  GetMessagesDto,
  MessageResponse,
  RoomResponse,
} from '../dto/chat.dto';

type ChatUserSource = {
  id: number;
  name: string;
  avatar: string | null;
};

type ChatMemberSource = {
  userId?: number;
  lastReadAt?: Date | null;
  user: ChatUserSource;
};

type ChatMessageSource = {
  id: number;
  content: string;
  roomId: number;
  createdAt: Date;
  sender: ChatUserSource;
};

type ChatRoomSource = {
  id: number;
  name: string | null;
  isPrivate: boolean;
  members: ChatMemberSource[];
  messages?: ChatMessageSource[];
  updatedAt: Date;
  createdAt: Date;
};

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
    if (allMemberIds.length < 2) {
      throw new BadRequestException(
        'A chat room needs at least one other member',
      );
    }
    await this.ensureUsersExist(allMemberIds);

    const directKey =
      isPrivate && allMemberIds.length === 2
        ? this.directRoomKeyFor(allMemberIds[0], allMemberIds[1])
        : null;

    // For private 1-on-1 chat, check if room already exists
    if (directKey) {
      const existingRoom = await this.findPrivateRoom(
        allMemberIds[0],
        allMemberIds[1],
      );
      if (existingRoom) {
        return this.formatRoomResponse(existingRoom);
      }
    }

    try {
      const room = await this.prisma.chatRoom.create({
        data: {
          name,
          isPrivate,
          directKey,
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
    } catch (error) {
      if (directKey && this.isUniqueConstraintError(error)) {
        const existingRoom = await this.findPrivateRoom(
          allMemberIds[0],
          allMemberIds[1],
        );
        if (existingRoom) {
          return this.formatRoomResponse(existingRoom);
        }
      }
      throw error;
    }
  }

  async findPrivateRoom(userId1: number, userId2: number) {
    const room = await this.prisma.chatRoom.findFirst({
      where: {
        isPrivate: true,
        directKey: this.directRoomKeyFor(userId1, userId2),
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

  async getUserContactIds(userId: number): Promise<number[]> {
    const members = await this.prisma.chatRoomMember.findMany({
      where: {
        userId: { not: userId },
        room: { members: { some: { userId } } },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return members.map((member) => member.userId);
  }

  async getRoomMemberIds(roomId: number): Promise<number[]> {
    const members = await this.prisma.chatRoomMember.findMany({
      where: { roomId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
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

    const counts = await this.prisma.$queryRaw<
      Array<{ roomId: number; count: bigint | number }>
    >(Prisma.sql`
      SELECT members."roomId" AS "roomId", COUNT(messages.id) AS "count"
      FROM "chat_room_members" AS members
      LEFT JOIN "chat_messages" AS messages
        ON messages."roomId" = members."roomId"
        AND messages."createdAt" > members."lastReadAt"
        AND messages."senderId" <> ${userId}
      WHERE members."userId" = ${userId}
        AND members."roomId" IN (${Prisma.join(roomIds)})
      GROUP BY members."roomId"
    `);

    return new Map(counts.map((item) => [item.roomId, Number(item.count)]));
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
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      throw new BadRequestException('Message content is required');
    }

    // Verify sender is a member of the room
    const isMember = await this.isRoomMember(roomId, senderId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this room');
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          roomId,
          senderId,
          content: normalizedContent,
        },
        include: {
          sender: {
            select: { id: true, name: true, avatar: true },
          },
        },
      });

      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });

      return created;
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
    await this.prisma.$transaction(async (tx) => {
      await tx.chatRoomMember.deleteMany({
        where: { roomId, userId },
      });

      // If no members left, delete the room
      const remainingMembers = await tx.chatRoomMember.count({
        where: { roomId },
      });

      if (remainingMembers === 0) {
        await tx.chatRoom.delete({
          where: { id: roomId },
        });
      }
    });
  }

  private formatRoomResponse(
    room: ChatRoomSource,
    unreadCount = 0,
  ): RoomResponse {
    return {
      id: room.id,
      name: room.name,
      isPrivate: room.isPrivate,
      members: room.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar,
        lastReadAt: m.lastReadAt ?? undefined,
      })),
      lastMessage: room.messages?.[0]
        ? this.formatMessageResponse(room.messages[0])
        : undefined,
      unreadCount,
      updatedAt: room.updatedAt,
      createdAt: room.createdAt,
    };
  }

  private formatMessageResponse(message: ChatMessageSource): MessageResponse {
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

  private directRoomKeyFor(firstUserId: number, secondUserId: number): string {
    return [firstUserId, secondUserId].sort((a, b) => a - b).join(':');
  }

  private async ensureUsersExist(userIds: number[]): Promise<void> {
    const count = await this.prisma.user.count({
      where: { id: { in: userIds } },
    });
    if (count !== userIds.length) {
      throw new BadRequestException('One or more chat members do not exist');
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
