import { Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationTemplateService } from '../../../notifications/services/notification-template.service';
import { ContractEventsService } from '../contract-events.service';

describe('ContractEventsService', () => {
  function createService() {
    const notifications = { create: jest.fn().mockResolvedValue({ id: 1 }) };
    const chatService = { createRoom: jest.fn().mockResolvedValue({ id: 40 }) };
    const message = { id: 77, roomId: 40, content: 'hello' };
    const fanout = {
      saveMessageAndNotify: jest
        .fn()
        .mockResolvedValue({ message, recipientCount: 1 }),
    };
    const gateway = { broadcastNewMessage: jest.fn() };
    const redis = { invalidateUserCaches: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractEventsService(
      notifications as never,
      new NotificationTemplateService(),
      chatService as never,
      fanout as never,
      gateway as never,
      redis as never,
    );
    return {
      service,
      notifications,
      chatService,
      fanout,
      gateway,
      message,
      redis,
    };
  }

  const base = {
    actorId: 3,
    actorName: 'Lan Tran',
    title: 'New proposal',
    body: 'Lan Tran sent a proposal.',
    proposalId: 5,
  };

  afterEach(() => jest.restoreAllMocks());

  it('records one event row inside the given transaction', async () => {
    const { service } = createService();
    const tx = { contractEvent: { create: jest.fn() } };

    await service.record(tx as never, {
      contractId: 12,
      actorId: 3,
      type: 'milestone_funded',
      data: { milestoneId: 4, position: 1, amount: 300 },
    });
    await service.record(tx as never, {
      proposalId: 5,
      actorId: null,
      type: 'proposal_expired',
    });

    expect(tx.contractEvent.create).toHaveBeenNthCalledWith(1, {
      data: {
        contractId: 12,
        actorId: 3,
        type: 'milestone_funded',
        data: { milestoneId: 4, position: 1, amount: 300 },
      },
    });
    expect(tx.contractEvent.create).toHaveBeenNthCalledWith(2, {
      data: { proposalId: 5, actorId: null, type: 'proposal_expired' },
    });
  });

  it('clears the saved profile of each person when a contract is completed', async () => {
    const { service, redis, notifications } = createService();
    redis.invalidateUserCaches.mockRejectedValueOnce(new Error('redis down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    for (const recipientId of [2, 9]) {
      await service.announce({
        ...base,
        recipientId,
        kind: 'contract',
        step: 'contract_completed',
        recipientSide: recipientId === 9 ? 'freelancer' : 'client',
        contractId: 12,
      });
    }
    await service.announce({
      ...base,
      recipientId: 2,
      kind: 'contract',
      step: 'work_submitted',
      recipientSide: 'client',
      contractId: 12,
    });

    // A cache failure never blocks the notification.
    expect(notifications.create).toHaveBeenCalledTimes(3);
    expect(redis.invalidateUserCaches).toHaveBeenCalledTimes(2);
    expect(redis.invalidateUserCaches).toHaveBeenNthCalledWith(1, 2);
    expect(redis.invalidateUserCaches).toHaveBeenNthCalledWith(2, 9);
  });

  it('sends a proposal notification linking to the recipient tab and proposal', async () => {
    const { service, notifications, chatService } = createService();

    await service.announce({
      ...base,
      recipientId: 9,
      kind: 'proposal',
      step: 'proposal_sent',
      recipientSide: 'freelancer',
    });

    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 9,
        actorId: 3,
        type: NotificationType.PROPOSAL_UPDATE,
        title: base.title,
        body: base.body,
        actionUrl: '/contracts?tab=freelancer&proposal=5',
        metadata: {
          kind: 'proposal',
          step: 'proposal_sent',
          proposalId: 5,
          contractId: null,
          milestoneId: null,
          jobTitle: null,
          position: null,
          amount: null,
          rule: null,
          actorName: 'Lan Tran',
          title: 'New proposal',
        },
      }),
    );
    expect(chatService.createRoom).not.toHaveBeenCalled();
  });

  it('sends a contract notification linking to the contract (client tab)', async () => {
    const { service, notifications } = createService();

    await service.announce({
      recipientId: 2,
      actorId: 3,
      actorName: 'Lan Tran',
      kind: 'contract',
      step: 'work_submitted',
      title: 'Work submitted',
      body: 'Milestone 1 is ready.',
      contractId: 12,
      milestoneId: 4,
      recipientSide: 'client',
    });

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.CONTRACT_UPDATE,
        actionUrl: '/contracts?tab=client&contract=12',
        metadata: expect.objectContaining({
          kind: 'contract',
          step: 'work_submitted',
          contractId: 12,
          milestoneId: 4,
        }),
      }),
    );
  });

  it('sends the chat line as the person who acted and broadcasts it', async () => {
    const { service, chatService, fanout, gateway, message } = createService();

    await service.announce({
      ...base,
      recipientId: 9,
      kind: 'proposal',
      step: 'proposal_sent',
      recipientSide: 'freelancer',
      chat: { fromId: 3, toId: 9, text: 'Sent a proposal for X.' },
    });

    expect(chatService.createRoom).toHaveBeenCalledWith(3, {
      memberIds: [9],
      isPrivate: true,
    });
    expect(fanout.saveMessageAndNotify).toHaveBeenCalledTimes(1);
    expect(fanout.saveMessageAndNotify).toHaveBeenCalledWith(3, {
      roomId: 40,
      content: 'Sent a proposal for X.',
    });
    expect(gateway.broadcastNewMessage).toHaveBeenCalledWith(40, message);
  });

  it('logs a failing notification and still tries the chat line', async () => {
    const { service, notifications, fanout } = createService();
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    notifications.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.announce({
        ...base,
        recipientId: 9,
        kind: 'proposal',
        step: 'proposal_sent',
        recipientSide: 'freelancer',
        chat: { fromId: 3, toId: 9, text: 'hi' },
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('db down'));
    expect(fanout.saveMessageAndNotify).toHaveBeenCalledTimes(1);
  });

  it('logs a failing chat line without throwing', async () => {
    const { service, chatService } = createService();
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    chatService.createRoom.mockRejectedValue(new Error('room failed'));

    await expect(
      service.announce({
        ...base,
        recipientId: 9,
        kind: 'proposal',
        step: 'proposal_sent',
        recipientSide: 'freelancer',
        chat: { fromId: 3, toId: 9, text: 'hi' },
      }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('room failed'),
    );
  });
});
