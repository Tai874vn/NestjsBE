/**
 * Service for the connections module.
 * It sends, accepts, and removes connection requests, checks connection status, lists connections, and ranks people suggestions by shared skills and location.
 *
 * Calls: prisma.connection; prisma.user; NotificationsService
 * Used by:
 *   - src/modules/connections/connections.module.ts
 *   - src/modules/connections/controllers/connections.controller.ts
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConnectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
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

type PublicConnectionUser = {
  id: number;
  name: string;
  avatar: string | null;
  headline: string | null;
  bio: string | null;
  location: string | null;
  profileSkills: Array<{
    id: number;
    name: string;
    level: string | null;
    sortOrder: number;
  }>;
  portfolioItems: Array<{ id: number }>;
};

type ConnectionWithUsers = {
  id: number;
  status: ConnectionStatus;
  requesterId: number;
  recipientId: number;
  createdAt: Date;
  updatedAt: Date;
  requester: PublicConnectionUser;
  recipient: PublicConnectionUser;
};

/** How many related people (shared skill or city) are ranked for the suggestions list. */
const SUGGESTION_POOL = 300;
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly notifications?: NotificationsService,
  ) {}

  // POST /api/connections/requests/:userId — Sends a connection request.
  // Query: user.findUnique, connection.findUnique, connection.create
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
    let connection: { id: number };
    try {
      connection = await this.prisma.connection.create({
        data: { pairKey, requesterId, recipientId },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A connection request already exists');
      }
      throw error;
    }
    await this.notifications?.notifyConnectionRequest({
      requesterId,
      recipientId,
      connectionId: connection.id,
    });
    return { message: 'Connection request sent', content: connection };
  }

  // PUT /api/connections/requests/:id/accept — The receiver accepts a request.
  // Query: connection.updateMany, connection.findUnique
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
    const accepted = await this.prisma.connection.updateMany({
      where: {
        id: connectionId,
        recipientId: userId,
        status: ConnectionStatus.PENDING,
      },
      data: { status: ConnectionStatus.ACCEPTED },
    });
    if (accepted.count === 0) {
      throw new ConflictException('Connection request is not pending');
    }
    const updated = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    });
    if (!updated) throw new NotFoundException('Connection not found');
    await this.notifications?.notifyConnectionAccepted({
      accepterId: userId,
      requesterId: connection.requesterId,
      connectionId,
    });
    return { message: 'Connection request accepted', content: updated };
  }

  // DELETE /api/connections/:id — Removes a connection, or cancels / declines a request.
  // Query: connection.delete
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

  // GET /api/connections/status/:userId — Connection state between the viewer and one person (button on the profile).
  // Query: connection.findUnique
  async getStatus(userId: number, targetUserId: number) {
    if (userId === targetUserId) {
      return {
        message: 'Connection status fetched',
        content: { state: 'self', connectionId: null },
      };
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

  // GET /api/connections/requests — Pending requests: received and sent.
  // Query: connection.findMany
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
      .map((item) => ({
        ...this.mapConnection(item, userId),
        direction: 'incoming',
      }));
    const outgoing = connections
      .filter((item) => item.requesterId === userId)
      .map((item) => ({
        ...this.mapConnection(item, userId),
        direction: 'outgoing',
      }));
    return {
      message: 'Connection requests fetched',
      content: { incoming, outgoing, incomingCount: incoming.length },
    };
  }

  // GET /api/connections — Accepted connections of the user, by page.
  // Query: connection.findMany, connection.count
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

  // GET /api/connections/suggestions — "People you may know": people with shared skills or the same location first, then everyone else.
  // Query: user.findUnique, connection.findMany, user.findMany, user.count
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
    // Rank first, then cut the page. People who share a skill or the city with the viewer come first;
    // the rest (newest accounts first) fill the list after them.
    const viewerSkillNames = viewer.profileSkills.map((skill) => skill.name);
    const related: Prisma.UserWhereInput[] = [];
    if (viewerSkillNames.length)
      related.push({
        profileSkills: {
          some: { name: { in: viewerSkillNames, mode: 'insensitive' } },
        },
      });
    if (viewer.location)
      related.push({
        location: { equals: viewer.location, mode: 'insensitive' },
      });
    const windowEnd = page * pageSize;
    const [close, total] = await Promise.all([
      related.length
        ? this.prisma.user.findMany({
            where: { AND: [where, { OR: related }] },
            orderBy: { id: 'desc' },
            take: SUGGESTION_POOL,
            select: publicUserSelect,
          })
        : Promise.resolve([]),
      this.prisma.user.count({ where }),
    ]);
    const others = await this.prisma.user.findMany({
      where: { AND: [where, { id: { notIn: close.map((user) => user.id) } }] },
      orderBy: { id: 'desc' },
      take: Math.max(0, windowEnd - close.length),
      select: publicUserSelect,
    });
    const viewerSkills = new Set(
      viewerSkillNames.map((name) => name.toLowerCase()),
    );
    const score = (candidate: (typeof close)[number]) => {
      const sharedSkills = candidate.profileSkills
        .filter((skill) => viewerSkills.has(skill.name.toLowerCase()))
        .map((skill) => skill.name);
      const sameLocation = Boolean(
        viewer.location &&
        candidate.location &&
        viewer.location.toLowerCase() === candidate.location.toLowerCase(),
      );
      return {
        ...this.publicUser(candidate),
        sharedSkills,
        sameLocation,
        suggestionScore:
          sharedSkills.length * 5 +
          (sameLocation ? 3 : 0) +
          (candidate.headline ? 1 : 0) +
          (candidate.bio ? 1 : 0) +
          (candidate.portfolioItems.length ? 1 : 0),
      };
    };
    const byScore = (
      a: { suggestionScore: number; id: number },
      b: { suggestionScore: number; id: number },
    ) => b.suggestionScore - a.suggestionScore || b.id - a.id;
    const ranked = [
      ...close.map(score).sort(byScore),
      ...others.map(score).sort(byScore),
    ].slice((page - 1) * pageSize, windowEnd);
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

  private mapConnection(connection: ConnectionWithUsers, userId: number) {
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

  private publicUser(user: PublicConnectionUser) {
    return {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      headline: user.headline,
      bio: user.bio,
      location: user.location,
      profileSkills: user.profileSkills,
    };
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

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
