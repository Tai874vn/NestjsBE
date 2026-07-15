import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import {
  ObservabilityService,
  OperationTimer,
} from '../../../common/observability/observability.service';
import { NotificationsQueryDto } from '../dto/notifications-query.dto';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import { NotificationPresenterService } from './notification-presenter.service';
import { NotificationTemplateService } from './notification-template.service';
import { CreateNotificationInput, notificationActorSelect } from './notification.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: NotificationTemplateService,
    private readonly presenter: NotificationPresenterService,
    @Optional()
    private readonly gateway?: NotificationsGateway,
    @Optional()
    private readonly observability?: ObservabilityService,
  ) {}

  async list(userId: number, query: NotificationsQueryDto) {
    const limit = query.limit ?? 20;
    const baseWhere: Prisma.NotificationWhereInput = {
      recipientId: userId,
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    };
    const orderBy: Prisma.NotificationOrderByWithRelationInput[] = [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ];

    const unreadNotifications = await this.prisma.notification.findMany({
      where: { ...baseWhere, readAt: null },
      take: limit + 1,
      orderBy,
      include: { actor: { select: notificationActorSelect } },
    });
    let notifications = unreadNotifications;

    if (notifications.length <= limit) {
      const readNotifications = await this.prisma.notification.findMany({
        where: { ...baseWhere, readAt: { not: null } },
        take: limit + 1 - notifications.length,
        orderBy,
        include: { actor: { select: notificationActorSelect } },
      });
      notifications = [...notifications, ...readNotifications];
    }

    const hasMore = notifications.length > limit;
    const data = notifications.slice(0, limit).map((item) => this.presenter.format(item));

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
      include: { actor: { select: notificationActorSelect } },
    });
    await this.emitUnreadCount(userId);

    return {
      message: 'Notification marked as read',
      content: notification ? this.presenter.format(notification) : null,
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
            include: { actor: { select: notificationActorSelect } },
          })
        : await this.prisma.notification.create({
            data,
            include: { actor: { select: notificationActorSelect } },
          });

      const formatted = this.presenter.format(notification);
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
    return this.create(this.templates.connectionRequest(input));
  }

  notifyConnectionAccepted(input: {
    accepterId: number;
    requesterId: number;
    connectionId: number;
  }) {
    return this.create(this.templates.connectionAccepted(input));
  }

  notifyPostLike(input: {
    actorId: number;
    recipientId: number;
    postId: number;
    postTitle?: string;
  }) {
    return this.create(this.templates.postLike(input));
  }

  notifyPostComment(input: {
    actorId: number;
    recipientId: number;
    postId: number;
    commentId: number;
    preview: string;
    postTitle?: string;
  }) {
    return this.create(this.templates.postComment(input));
  }

  notifyHireCreated(input: {
    hirerId: number;
    recipientId: number;
    hireId: number;
    jobId: number;
    jobTitle: string;
  }) {
    return this.create(this.templates.hireCreated(input));
  }

  notifyHireCompleted(input: {
    actorId: number;
    recipientId: number;
    hireId: number;
    jobId: number;
    jobTitle: string;
  }) {
    return this.create(this.templates.hireCompleted(input));
  }

  async notifyChatMessageRecipients(input: {
    senderId: number;
    recipients: Array<{ recipientId: number; unreadCount: number }>;
    roomId: number;
    messageId: number;
  }) {
    const timer = this.observability?.startOperation('notifications.socket.fanout', {
      senderId: input.senderId,
      roomId: input.roomId,
      messageId: input.messageId,
      recipientCount: input.recipients.length,
    });

    try {
      await this.timeStep(timer, 'notification.upsertAndEmit', () =>
        Promise.all(
          input.recipients.map(({ recipientId, unreadCount }) =>
            this.create(this.templates.chatMessage({
              recipientId,
              senderId: input.senderId,
              unreadCount,
              roomId: input.roomId,
              messageId: input.messageId,
            })),
          ),
        ),
      );
      timer?.end();
    } catch (error) {
      timer?.fail(error);
      throw error;
    }
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

  private timeStep<T>(
    timer: OperationTimer | undefined,
    step: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return timer ? timer.time(step, callback) : callback();
  }
}
