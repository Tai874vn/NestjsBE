import { NotificationType } from '@prisma/client';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import { NotificationPresenterService } from './notification-presenter.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  function createService() {
    const prisma = {
      notification: {
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const gateway = {
      emitNotification: jest.fn(),
      emitUnreadCount: jest.fn(),
    };
    const service = new NotificationsService(
      prisma as never,
      new NotificationTemplateService(),
      new NotificationPresenterService(),
      gateway as unknown as NotificationsGateway,
    );
    return { service, prisma, gateway };
  }

  it('lists unread notifications first by latest activity', async () => {
    const { service, prisma } = createService();
    prisma.notification.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.list(6, { limit: 8 });

    expect(prisma.notification.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { recipientId: 6, readAt: null },
        take: 9,
        orderBy: [
          { updatedAt: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
    expect(prisma.notification.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { recipientId: 6, readAt: { not: null } },
        take: 9,
      }),
    );
  });

  it('skips notifications for self actions', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create({
        recipientId: 6,
        actorId: 6,
        type: NotificationType.POST_LIKE,
        title: 'New reaction',
        body: 'liked your post.',
      }),
    ).resolves.toBeNull();

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('persists and emits created notifications with unread count', async () => {
    const { service, prisma, gateway } = createService();
    const createdAt = new Date('2026-07-01T02:00:00.000Z');
    prisma.notification.create.mockResolvedValue({
      id: 9,
      recipientId: 6,
      actorId: 7,
      type: NotificationType.POST_COMMENT,
      title: 'New comment',
      body: 'Looks great.',
      entityType: 'post_comment',
      entityId: 4,
      actionUrl: '/?postId=3',
      metadata: { postId: 3, commentId: 4 },
      dedupeKey: null,
      readAt: null,
      createdAt,
      updatedAt: createdAt,
      actor: { id: 7, name: 'Lina', avatar: null, headline: null },
    });
    prisma.notification.count.mockResolvedValue(3);

    const result = await service.create({
      recipientId: 6,
      actorId: 7,
      type: NotificationType.POST_COMMENT,
      title: 'New comment',
      body: 'Looks great.',
      entityType: 'post_comment',
      entityId: 4,
      actionUrl: '/?postId=3',
      metadata: { postId: 3, commentId: 4 },
    });

    expect(result).toMatchObject({ id: 9, type: NotificationType.POST_COMMENT });
    expect(gateway.emitNotification).toHaveBeenCalledWith(6, expect.objectContaining({ id: 9 }));
    expect(gateway.emitUnreadCount).toHaveBeenCalledWith(6, 3);
  });

  it('stores post title previews for post comment notifications', async () => {
    const { service, prisma } = createService();
    const createdAt = new Date('2026-07-01T02:00:00.000Z');
    prisma.notification.create.mockResolvedValue({
      id: 10,
      recipientId: 6,
      actorId: 7,
      type: NotificationType.POST_COMMENT,
      title: 'New comment',
      body: 'Interesting idea.',
      entityType: 'post_comment',
      entityId: 5,
      actionUrl: '/?postId=3',
      metadata: { postId: 3, commentId: 5, postTitle: 'Building a hiring platform' },
      dedupeKey: null,
      readAt: null,
      createdAt,
      updatedAt: createdAt,
      actor: { id: 7, name: 'Lina', avatar: null, headline: null },
    });
    prisma.notification.count.mockResolvedValue(1);

    await service.notifyPostComment({
      actorId: 7,
      recipientId: 6,
      postId: 3,
      commentId: 5,
      preview: 'Interesting idea.',
      postTitle: 'Building a hiring platform',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: { postId: 3, commentId: 5, postTitle: 'Building a hiring platform' },
        }),
      }),
    );
  });

  it('aggregates chat message notifications by room and recipient', async () => {
    const { service, prisma } = createService();
    const createdAt = new Date('2026-07-02T02:00:00.000Z');
    prisma.notification.upsert.mockResolvedValue({
      id: 12,
      recipientId: 6,
      actorId: 7,
      type: NotificationType.CHAT_MESSAGE,
      title: 'New messages',
      body: '3 new messages',
      entityType: 'chat_message',
      entityId: 44,
      actionUrl: null,
      metadata: { roomId: 4, messageId: 44, unreadCount: 3 },
      dedupeKey: 'chat_message:4:6',
      readAt: null,
      createdAt,
      updatedAt: createdAt,
      actor: { id: 7, name: 'Lina', avatar: null, headline: null },
    });
    prisma.notification.count.mockResolvedValue(1);

    await service.notifyChatMessageRecipients({
      senderId: 7,
      recipients: [{ recipientId: 6, unreadCount: 3 }],
      roomId: 4,
      messageId: 44,
    });

    expect(prisma.notification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupeKey: 'chat_message:4:6' },
        create: expect.objectContaining({ body: '3 new messages' }),
        update: expect.objectContaining({
          body: '3 new messages',
          metadata: { roomId: 4, messageId: 44, unreadCount: 3 },
          readAt: null,
        }),
      }),
    );
  });
});
