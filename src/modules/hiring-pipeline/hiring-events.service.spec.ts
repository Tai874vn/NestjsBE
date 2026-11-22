import { Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationTemplateService } from '../notifications/services/notification-template.service';
import { HiringEventsService } from './hiring-events.service';

describe('HiringEventsService', () => {
  function createService() {
    const notifications = { create: jest.fn().mockResolvedValue({ id: 1 }) };
    const chatService = { createRoom: jest.fn().mockResolvedValue({ id: 40 }) };
    const message = { id: 77, roomId: 40, content: 'Interview request' };
    const fanout = {
      saveMessageAndNotify: jest
        .fn()
        .mockResolvedValue({ message, recipientCount: 1 }),
    };
    const gateway = { broadcastNewMessage: jest.fn() };
    const service = new HiringEventsService(
      notifications as never,
      new NotificationTemplateService(),
      chatService as never,
      fanout as never,
      gateway as never,
    );
    return { service, notifications, chatService, fanout, gateway, message };
  }

  const base = {
    actorId: 3,
    title: 'Shortlisted',
    body: 'You are on the shortlist for Senior Test Engineer.',
    applicationId: 21,
    postId: 8,
  };

  afterEach(() => jest.restoreAllMocks());

  it('records one event row inside the given transaction', async () => {
    const { service } = createService();
    const tx = { hiringApplicationEvent: { create: jest.fn() } };

    await service.record(tx as never, {
      applicationId: 21,
      actorId: 3,
      type: 'SHORTLISTED',
      data: { note: 'good fit' },
    });

    expect(tx.hiringApplicationEvent.create).toHaveBeenCalledWith({
      data: {
        applicationId: 21,
        actorId: 3,
        type: 'SHORTLISTED',
        data: { note: 'good fit' },
      },
    });
  });

  it('sends one candidate notification with the My applications link', async () => {
    const { service, notifications, chatService } = createService();

    await service.announce({
      ...base,
      recipientId: 9,
      kind: 'application',
      forRecruiter: false,
    });

    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 9,
        actorId: 3,
        type: NotificationType.APPLICATION_UPDATE,
        title: base.title,
        body: base.body,
        entityType: 'hiring_application',
        entityId: 21,
        actionUrl: '/my-applications?application=21',
        metadata: { applicationId: 21, postId: 8 },
      }),
    );
    expect(chatService.createRoom).not.toHaveBeenCalled();
  });

  it('sends the recruiter the pipeline link and maps each kind to its type', async () => {
    const { service, notifications } = createService();

    await service.announce({
      ...base,
      recipientId: 3,
      actorId: 9,
      kind: 'received',
      forRecruiter: true,
    });
    await service.announce({
      ...base,
      recipientId: 3,
      actorId: 9,
      kind: 'interview',
      forRecruiter: true,
    });

    const calls = notifications.create.mock.calls.map(
      ([input]: [{ type: NotificationType; actionUrl: string }]) => input,
    );
    expect(calls.map((input) => input.type)).toEqual([
      NotificationType.APPLICATION_RECEIVED,
      NotificationType.INTERVIEW_UPDATE,
    ]);
    expect(calls[0].actionUrl).toBe(
      '/my-hiring-posts/8/applicants?application=21',
    );
  });

  it('with chat text, saves one message as the recruiter and broadcasts it', async () => {
    const { service, chatService, fanout, gateway, message } = createService();

    await service.announce({
      ...base,
      recipientId: 9,
      kind: 'interview',
      forRecruiter: false,
      chat: 'Interview request for Senior Test Engineer: Tue 25 Nov 10:00',
      chatBetween: { recruiterId: 3, candidateId: 9 },
    });

    expect(chatService.createRoom).toHaveBeenCalledWith(3, {
      memberIds: [9],
      isPrivate: true,
    });
    expect(fanout.saveMessageAndNotify).toHaveBeenCalledTimes(1);
    expect(fanout.saveMessageAndNotify).toHaveBeenCalledWith(3, {
      roomId: 40,
      content: 'Interview request for Senior Test Engineer: Tue 25 Nov 10:00',
    });
    expect(gateway.broadcastNewMessage).toHaveBeenCalledWith(40, message);
  });

  it('logs and does not throw when the notification fails', async () => {
    const { service, notifications, fanout } = createService();
    notifications.create.mockRejectedValue(new Error('db down'));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.announce({
        ...base,
        recipientId: 9,
        kind: 'interview',
        forRecruiter: false,
        chat: 'Interview request',
        chatBetween: { recruiterId: 3, candidateId: 9 },
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalled();
    // The chat message is a separate step, so it is still sent.
    expect(fanout.saveMessageAndNotify).toHaveBeenCalledTimes(1);
  });

  it('logs and does not throw when the chat message fails', async () => {
    const { service, chatService, notifications } = createService();
    chatService.createRoom.mockRejectedValue(new Error('no user'));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.announce({
        ...base,
        recipientId: 9,
        kind: 'application',
        forRecruiter: false,
        chat: 'Offer sent',
        chatBetween: { recruiterId: 3, candidateId: 9 },
      }),
    ).resolves.toBeUndefined();

    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalled();
  });
});
