import { NotificationType } from '@prisma/client';
import { NotificationsGateway } from '../gateways/notifications.gateway';
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
      gateway as unknown as NotificationsGateway,
    );
    return { service, prisma, gateway };
  }

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
