import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConnectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { ConnectionsQueryDto } from '../dto/connections-query.dto';

export function pairKeyFor(firstUserId: number, secondUserId: number) {
  return [firstUserId, secondUserId].sort((a, b) => a - b).join(':');
}

const publicUserSelect = {
  id: true,
  name: true,
  avatar: true,
  headline: true,
  bio: true,
  location: true,
  profileSkills: {
    select: { id: true, name: true, level: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  portfolioItems: { select: { id: true } },
};

@Injectable()
export class ConnectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async sendRequest(requesterId: number, recipientId: number) {
    if (requesterId === recipientId) {
      throw new BadRequestException('You cannot connect with yourself');
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true },
    });
    if (!recipient) throw new NotFoundException('User not found');
    const pairKey = pairKeyFor(requesterId, recipientId);
    const existing = await this.prisma.connection.findUnique({
      where: { pairKey },
    });
    if (existing) {
      throw new ConflictException(
        existing.status === ConnectionStatus.ACCEPTED
          ? 'Users are already connected'
          : 'A connection request already exists',
      );
    }
    const connection = await this.prisma.connection.create({
      data: { pairKey, requesterId, recipientId },
    });
    return { message: 'Connection request sent', content: connection };
  }

  async acceptRequest(connectionId: number, userId: number) {
    const connection = await this.getConnection(connectionId);
    if (connection.status !== ConnectionStatus.PENDING) {
      throw new ConflictException('Connection request is not pending');
    }
    if (connection.recipientId !== userId) {
      throw new ForbiddenException(
        'Only the request recipient can accept this request',
      );
    }
    const updated = await this.prisma.connection.update({
      where: { id: connectionId },
      data: { status: ConnectionStatus.ACCEPTED },
    });
    return { message: 'Connection request accepted', content: updated };
  }

  async deleteConnection(connectionId: number, userId: number) {
    const connection = await this.getConnection(connectionId);
    if (
      connection.requesterId !== userId &&
      connection.recipientId !== userId
    ) {
      throw new ForbiddenException('You are not part of this connection');
    }
    await this.prisma.connection.delete({ where: { id: connectionId } });
    return { message: 'Connection removed successfully' };
  }

  async getStatus(userId: number, targetUserId: number) {
    if (userId === targetUserId) {
      return { message: 'Connection status fetched', content: { state: 'self', connectionId: null } };
    }
    const connection = await this.prisma.connection.findUnique({
      where: { pairKey: pairKeyFor(userId, targetUserId) },
    });
    let state = 'none';
    if (connection?.status === ConnectionStatus.ACCEPTED) state = 'connected';
    if (connection?.status === ConnectionStatus.PENDING) {
      state =
        connection.requesterId === userId
          ? 'outgoing_pending'
          : 'incoming_pending';
    }
    return {
      message: 'Connection status fetched',
      content: { state, connectionId: connection?.id ?? null },
    };
  }

  async getRequests(userId: number) {
    const connections = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.PENDING,
        OR: [{ requesterId: userId }, { recipientId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        requester: { select: publicUserSelect },
        recipient: { select: publicUserSelect },
      },
    });
    const incoming = connections
      .filter((item) => item.recipientId === userId)
      .map((item) => ({ ...this.mapConnection(item, userId), direction: 'incoming' }));
    const outgoing = connections
      .filter((item) => item.requesterId === userId)
      .map((item) => ({ ...this.mapConnection(item, userId), direction: 'outgoing' }));
    return {
      message: 'Connection requests fetched',
      content: { incoming, outgoing, incomingCount: incoming.length },
    };
  }

  async getConnections(userId: number, query: ConnectionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const keyword = query.keyword?.trim();
    const userFilter = keyword ? this.userKeywordWhere(keyword) : undefined;
    const where: Prisma.ConnectionWhereInput = {
      status: ConnectionStatus.ACCEPTED,
      OR: [
        {
          requesterId: userId,
          ...(userFilter ? { recipient: userFilter } : {}),
        },
        {
          recipientId: userId,
          ...(userFilter ? { requester: userFilter } : {}),
        },
      ],
    };
    const [connections, total] = await Promise.all([
      this.prisma.connection.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          requester: { select: publicUserSelect },
          recipient: { select: publicUserSelect },
        },
      }),
      this.prisma.connection.count({ where }),
    ]);
    return {
      message: 'Connections fetched',
      content: {
        pageIndex: page,
        pageSize,
        totalRow: total,
        totalPages: Math.ceil(total / pageSize),
        data: connections.map((item) => this.mapConnection(item, userId)),
      },
    };
  }

  async getSuggestions(userId: number, query: ConnectionsQueryDto) {
    const [viewer, connections] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          location: true,
          profileSkills: { select: { name: true } },
        },
      }),
      this.prisma.connection.findMany({
        where: { OR: [{ requesterId: userId }, { recipientId: userId }] },
        select: { requesterId: true, recipientId: true },
      }),
    ]);
    if (!viewer) throw new NotFoundException('User not found');
    const excludedIds = new Set<number>([userId]);
    connections.forEach((item) => {
      excludedIds.add(item.requesterId);
      excludedIds.add(item.recipientId);
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const keyword = query.keyword?.trim();
    const where: Prisma.UserWhereInput = {
      id: { notIn: [...excludedIds] },
      ...(keyword ? this.userKeywordWhere(keyword) : {}),
    };
    const [candidates, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: publicUserSelect,
      }),
      this.prisma.user.count({ where }),
    ]);
    const viewerSkills = new Set(
      viewer.profileSkills.map((skill) => skill.name.toLowerCase()),
    );
    const ranked = candidates
      .map((candidate) => {
        const sharedSkills = candidate.profileSkills
          .filter((skill) => viewerSkills.has(skill.name.toLowerCase()))
          .map((skill) => skill.name);
        const sameLocation = Boolean(
          viewer.location &&
            candidate.location &&
            viewer.location.toLowerCase() === candidate.location.toLowerCase(),
        );
        const score =
          sharedSkills.length * 5 +
          (sameLocation ? 3 : 0) +
          (candidate.headline ? 1 : 0) +
          (candidate.bio ? 1 : 0) +
          (candidate.portfolioItems.length ? 1 : 0);
        return {
          ...this.publicUser(candidate),
          sharedSkills,
          sameLocation,
          suggestionScore: score,
        };
      })
      .sort((a, b) => b.suggestionScore - a.suggestionScore || b.id - a.id);
    return {
      message: 'Connection suggestions fetched',
      content: {
        pageIndex: page,
        pageSize,
        totalRow: total,
        totalPages: Math.ceil(total / pageSize),
        data: ranked,
      },
    };
  }

  private async getConnection(connectionId: number) {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }

  private mapConnection(connection: any, userId: number) {
    const other =
      connection.requesterId === userId
        ? connection.recipient
        : connection.requester;
    return {
      id: connection.id,
      status: connection.status,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      user: this.publicUser(other),
    };
  }

  private publicUser(user: any) {
    const { portfolioItems: _portfolioItems, ...publicUser } = user;
    return publicUser;
  }

  private userKeywordWhere(keyword: string): Prisma.UserWhereInput {
    return {
      OR: [
        { name: { contains: keyword, mode: 'insensitive' } },
        { headline: { contains: keyword, mode: 'insensitive' } },
        { location: { contains: keyword, mode: 'insensitive' } },
        {
          profileSkills: {
            some: { name: { contains: keyword, mode: 'insensitive' } },
          },
        },
      ],
    };
  }
}
