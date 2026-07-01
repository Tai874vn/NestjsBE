import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { NotificationsQueryDto } from '../dto/notifications-query.dto';
import { NotificationsGateway } from '../gateways/notifications.gateway';

const actorSelect = {
  id: true,
  name: true,
  avatar: true,
  headline: true,
} as const;

type NotificationWithActor = Prisma.NotificationGetPayload<{
  include: { actor: { select: typeof actorSelect } };
}>;

type CreateNotificationInput = {
  recipientId: number;
  actorId?: number | null;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: number;
  actionUrl?: string | null;
  metadata?: Prisma.InputJsonValue;
  dedupeKey?: string;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly gateway?: NotificationsGateway,
  ) {}

  async list(userId: number, query: NotificationsQueryDto) {
    const limit = query.limit ?? 20;
    const notifications = await this.prisma.notification.findMany({
      where: {
        recipientId: userId,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      take: limit + 1,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { actor: { select: actorSelect } },
    });
    const hasMore = notifications.length > limit;
    const data = notifications.slice(0, limit).map((item) => this.format(item));

    return {
      message: 'Notifications fetched successfully',
      content: {
        data,
        nextCursor: hasMore && data.length ? data[data.length - 1].id : null,
      },
    };
  }

  async unreadCount(userId: number) {
    const unreadCount = await this.countUnread(userId);
    return {
      message: 'Unread notification count fetched successfully',
      content: { unreadCount },
    };
  }

  async markAsRead(notificationId: number, userId: number) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: userId },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Notification not found');

    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { actor: { select: actorSelect } },
    });
    await this.emitUnreadCount(userId);

    return {
      message: 'Notification marked as read',
      content: notification ? this.format(notification) : null,
    };
  }

  async markAllAsRead(userId: number) {
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    this.gateway?.emitUnreadCount(userId, 0);
    return {
      message: 'Notifications marked as read',
      content: { unreadCount: 0 },
    };
  }

  async create(input: CreateNotificationInput) {
    if (input.actorId && input.actorId === input.recipientId) return null;

    try {
      const data = this.createData(input);
      const notification = input.dedupeKey
        ? await this.prisma.notification.upsert({
            where: { dedupeKey: input.dedupeKey },
            create: data,
            update: {
              actorId: input.actorId ?? null,
              title: input.title,
              body: input.body,
              entityType: input.entityType,
              entityId: input.entityId,
              actionUrl: input.actionUrl,
              metadata: input.metadata,
              readAt: null,
            },
            include: { actor: { select: actorSelect } },
          })
        : await this.prisma.notification.create({
            data,
            include: { actor: { select: actorSelect } },
          });

      const formatted = this.format(notification);
      this.gateway?.emitNotification(input.recipientId, formatted);
      await this.emitUnreadCount(input.recipientId);
      return formatted;
    } catch (error) {
      this.logger.error(
        `Failed to create notification: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  notifyConnectionRequest(input: {
    requesterId: number;
    recipientId: number;
    connectionId: number;
  }) {
    return this.create({
      recipientId: input.recipientId,
      actorId: input.requesterId,
      type: NotificationType.CONNECTION_REQUEST,
      title: 'New connection request',
      body: 'sent you a connection request.',
      entityType: 'connection',
      entityId: input.connectionId,
      actionUrl: '/connections',
      metadata: { connectionId: input.connectionId },
      dedupeKey: `connection_request:${input.connectionId}`,
    });
  }

  notifyConnectionAccepted(input: {
    accepterId: number;
    requesterId: number;
    connectionId: number;
  }) {
    return this.create({
      recipientId: input.requesterId,
      actorId: input.accepterId,
      type: NotificationType.CONNECTION_ACCEPTED,
      title: 'Connection accepted',
      body: 'accepted your connection request.',
      entityType: 'connection',
      entityId: input.connectionId,
      actionUrl: '/connections',
      metadata: { connectionId: input.connectionId },
      dedupeKey: `connection_accepted:${input.connectionId}`,
    });
  }

  notifyPostLike(input: {
    actorId: number;
    recipientId: number;
    postId: number;
  }) {
    return this.create({
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.POST_LIKE,
      title: 'New reaction',
      body: 'liked your post.',
      entityType: 'post',
      entityId: input.postId,
      actionUrl: `/?postId=${input.postId}`,
      metadata: { postId: input.postId },
      dedupeKey: `post_like:${input.postId}:${input.actorId}`,
    });
  }

  notifyPostComment(input: {
    actorId: number;
    recipientId: number;
    postId: number;
    commentId: number;
    preview: string;
  }) {
    return this.create({
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.POST_COMMENT,
      title: 'New comment',
      body: this.preview(input.preview, 'commented on your post.'),
      entityType: 'post_comment',
      entityId: input.commentId,
      actionUrl: `/?postId=${input.postId}`,
      metadata: { postId: input.postId, commentId: input.commentId },
    });
  }

  notifyHireCreated(input: {
    hirerId: number;
    recipientId: number;
    hireId: number;
    jobId: number;
    jobTitle: string;
  }) {
    return this.create({
      recipientId: input.recipientId,
      actorId: input.hirerId,
      type: NotificationType.HIRE_CREATED,
      title: 'New hire',
      body: `hired ${input.jobTitle}.`,
      entityType: 'hire',
      entityId: input.hireId,
      actionUrl: `/jobs/${input.jobId}`,
      metadata: { hireId: input.hireId, jobId: input.jobId },
      dedupeKey: `hire_created:${input.hireId}`,
    });
  }

  notifyHireCompleted(input: {
    actorId: number;
    recipientId: number;
    hireId: number;
    jobId: number;
    jobTitle: string;
  }) {
    return this.create({
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.HIRE_COMPLETED,
      title: 'Work completed',
      body: `marked ${input.jobTitle} as complete.`,
      entityType: 'hire',
      entityId: input.hireId,
      actionUrl: `/jobs/${input.jobId}`,
      metadata: { hireId: input.hireId, jobId: input.jobId },
      dedupeKey: `hire_completed:${input.hireId}`,
    });
  }

  async notifyChatMessageRecipients(input: {
    senderId: number;
    recipients: Array<{ recipientId: number; unreadCount: number }>;
    roomId: number;
    messageId: number;
  }) {
    await Promise.all(
      input.recipients.map(({ recipientId, unreadCount }) =>
        this.create({
          recipientId,
          actorId: input.senderId,
          type: NotificationType.CHAT_MESSAGE,
          title: 'New messages',
          body: this.chatMessageBody(unreadCount),
          entityType: 'chat_message',
          entityId: input.messageId,
          actionUrl: null,
          metadata: {
            roomId: input.roomId,
            messageId: input.messageId,
            unreadCount,
          },
          dedupeKey: `chat_message:${input.roomId}:${recipientId}`,
        }),
      ),
    );
  }

  private createData(input: CreateNotificationInput) {
    return {
      recipientId: input.recipientId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      actionUrl: input.actionUrl,
      metadata: input.metadata,
      dedupeKey: input.dedupeKey,
    };
  }

  private async emitUnreadCount(userId: number) {
    const unreadCount = await this.countUnread(userId);
    this.gateway?.emitUnreadCount(userId, unreadCount);
  }

  private countUnread(userId: number) {
    return this.prisma.notification.count({
      where: { recipientId: userId, readAt: null },
    });
  }

  private preview(value: string, fallback: string) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return fallback;
    return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
  }

  private chatMessageBody(unreadCount: number) {
    const safeCount = Math.max(1, unreadCount);
    return safeCount === 1 ? '1 new message' : `${safeCount} new messages`;
  }

  private format(notification: NotificationWithActor) {
    return {
      id: notification.id,
      recipientId: notification.recipientId,
      actorId: notification.actorId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      entityType: notification.entityType,
      entityId: notification.entityId,
      actionUrl: notification.actionUrl,
      metadata: notification.metadata,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      actor: notification.actor,
    };
  }
}
