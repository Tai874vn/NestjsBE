import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma.service';
import {
  ObservabilityService,
  OperationTimer,
} from '../../../common/observability/observability.service';
import { NotificationsQueryDto } from '../dto/notifications-query.dto';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import { NotificationPresenterService } from './notification-presenter.service';
import { NotificationTemplateService } from './notification-template.service';
import {
  CreateNotificationInput,
  notificationActorSelect,
} from '../utils/notification.types';

type NotificationCursor = {
  phase: 'unread' | 'read';
  updatedAt: string;
  id: number;
};

type NotificationCursorSource = {
  id: number;
  updatedAt: Date;
};
type NotificationListItem = Prisma.NotificationGetPayload<{
  include: { actor: { select: typeof notificationActorSelect } };
}>;

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

  // GET /api/notifications — The bell list: newest notifications, by cursor.
  // Query: notification.findMany
  async list(userId: number, query: NotificationsQueryDto) {
    const limit = query.limit ?? 20;
    const cursor = this.decodeCursor(query.cursor);
    const baseWhere: Prisma.NotificationWhereInput = {
      recipientId: userId,
    };
    const orderBy: Prisma.NotificationOrderByWithRelationInput[] = [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ];

    let notifications: NotificationListItem[] = [];
    let nextCursor: string | null = null;

    if (!cursor || cursor.phase === 'unread') {
      const unreadNotifications = await this.prisma.notification.findMany({
        where: {
          ...baseWhere,
          readAt: null,
          ...(cursor?.phase === 'unread' ? this.cursorWhere(cursor) : {}),
        },
        take: limit + 1,
        orderBy,
        include: { actor: { select: notificationActorSelect } },
      });
      notifications = unreadNotifications.slice(0, limit);

      if (unreadNotifications.length > limit) {
        nextCursor = this.encodeCursor(
          'unread',
          notifications[notifications.length - 1],
        );
      } else {
        const remaining = limit - notifications.length;
        if (remaining > 0) {
          const readNotifications = await this.prisma.notification.findMany({
            where: { ...baseWhere, readAt: { not: null } },
            take: remaining + 1,
            orderBy,
            include: { actor: { select: notificationActorSelect } },
          });
          const readPage = readNotifications.slice(0, remaining);
          notifications = [...notifications, ...readPage];
          if (readNotifications.length > remaining && readPage.length) {
            nextCursor = this.encodeCursor(
              'read',
              readPage[readPage.length - 1],
            );
          }
        } else if (notifications.length) {
          nextCursor = this.encodeCursor(
            'unread',
            notifications[notifications.length - 1],
          );
        }
      }
    } else {
      const readNotifications = await this.prisma.notification.findMany({
        where: {
          ...baseWhere,
          readAt: { not: null },
          ...this.cursorWhere(cursor),
        },
        take: limit + 1,
        orderBy,
        include: { actor: { select: notificationActorSelect } },
      });
      notifications = readNotifications.slice(0, limit);
      if (readNotifications.length > limit && notifications.length) {
        nextCursor = this.encodeCursor(
          'read',
          notifications[notifications.length - 1],
        );
      }
    }

    const data = notifications.map((item) => this.presenter.format(item));

    return {
      message: 'Notifications fetched successfully',
      content: {
        data,
        nextCursor,
      },
    };
  }

  // GET /api/notifications/unread-count — Number on the bell.
  // Query: see countUnread()
  async unreadCount(userId: number) {
    const unreadCount = await this.countUnread(userId);
    return {
      message: 'Unread notification count fetched successfully',
      content: { unreadCount },
    };
  }

  // PATCH /api/notifications/:id/read — Marks one notification read.
  // Query: notification.updateMany, notification.findUnique
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

  // PATCH /api/notifications/read-all — Marks every notification read.
  // Query: notification.updateMany
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

  /**
   * Save one notification and push it to the user live.
   *  - Never notify people about their own action.
   *  - dedupeKey: for events that can repeat (e.g. the same person likes, unlikes and likes the same post
   *    again), upsert (update the row if it exists, else insert it) keeps ONE notification and marks it
   *    unread again, instead of adding a new row each time.
   *  - Then send it through the WebSocket gateway, with the new unread count.
   *  A failure is only logged: a missing notification must never make the main action (send a message,
   *  apply to a job…) fail.
   */
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
      Sentry.captureException(error, {
        tags: { context: 'notifications.create' },
      });
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
    parentCommentId?: number;
    preview: string;
    postTitle?: string;
  }) {
    return this.create(this.templates.postComment(input));
  }

  async notifyChatMessageRecipients(input: {
    senderId: number;
    recipients: Array<{ recipientId: number; unreadCount: number }>;
    roomId: number;
    messageId: number;
  }) {
    const timer = this.observability?.startOperation(
      'notifications.socket.fanout',
      {
        senderId: input.senderId,
        roomId: input.roomId,
        messageId: input.messageId,
        recipientCount: input.recipients.length,
      },
    );

    try {
      await this.timeStep(timer, 'notification.upsertAndEmit', () =>
        Promise.all(
          input.recipients.map(({ recipientId, unreadCount }) =>
            this.create(
              this.templates.chatMessage({
                recipientId,
                senderId: input.senderId,
                unreadCount,
                roomId: input.roomId,
                messageId: input.messageId,
              }),
            ),
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

  private encodeCursor(
    phase: NotificationCursor['phase'],
    notification: NotificationCursorSource,
  ) {
    return Buffer.from(
      JSON.stringify({
        phase,
        updatedAt: notification.updatedAt.toISOString(),
        id: notification.id,
      } satisfies NotificationCursor),
    ).toString('base64url');
  }

  private decodeCursor(value?: string): NotificationCursor | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as NotificationCursor;
      if (
        (parsed.phase !== 'unread' && parsed.phase !== 'read') ||
        !Number.isInteger(parsed.id) ||
        parsed.id < 1 ||
        Number.isNaN(new Date(parsed.updatedAt).getTime())
      ) {
        throw new Error('invalid');
      }
      return parsed;
    } catch {
      throw new BadRequestException('Invalid notification cursor');
    }
  }

  private cursorWhere(
    cursor: NotificationCursor,
  ): Prisma.NotificationWhereInput {
    const updatedAt = new Date(cursor.updatedAt);
    return {
      OR: [
        { updatedAt: { lt: updatedAt } },
        { updatedAt, id: { lt: cursor.id } },
      ],
    };
  }

  private timeStep<T>(
    timer: OperationTimer | undefined,
    step: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return timer ? timer.time(step, callback) : callback();
  }
}
