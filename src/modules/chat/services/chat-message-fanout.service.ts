/**
 * Message fanout service for the chat module.
 * It saves a chat message, computes unread counts for the other room members, and triggers chat notifications.
 *
 * Calls: ChatService; NotificationsService
 * Used by:
 *   - src/modules/chat/chat.module.ts
 *   - src/modules/chat/gateways/chat.gateway.ts
 *   - src/modules/contracts/services/contract-events.service.ts
 *   - src/modules/hiring-pipeline/services/hiring-events.service.ts
 */

import { Injectable, Optional } from '@nestjs/common';
import { OperationTimer } from '../../../common/observability/observability.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { SendMessageDto } from '../dto/chat.dto';
import { ChatService } from './chat.service';

@Injectable()
export class ChatMessageFanoutService {
  constructor(
    private readonly chatService: ChatService,
    @Optional()
    private readonly notifications?: NotificationsService,
  ) {}

  async saveMessageAndNotify(
    senderId: number,
    dto: SendMessageDto,
    timer?: OperationTimer,
  ) {
    const message = await this.timeStep(timer, 'db.saveMessage', () =>
      this.chatService.saveMessage(senderId, dto),
    );

    const recipientIds = (
      await this.timeStep(timer, 'db.roomMembers', () =>
        this.chatService.getRoomMemberIds(dto.roomId),
      )
    ).filter((memberId) => memberId !== senderId);

    const unreadCounts = await this.timeStep(timer, 'db.unreadCounts', () =>
      this.chatService.getUnreadCounts(dto.roomId, recipientIds),
    );
    const recipients = recipientIds.map((recipientId) => ({
      recipientId,
      unreadCount: unreadCounts.get(recipientId) ?? 0,
    }));

    await this.timeStep(timer, 'notifications.fanout', async () => {
      await this.notifications?.notifyChatMessageRecipients({
        senderId,
        recipients,
        roomId: dto.roomId,
        messageId: message.id,
      });
    });

    return { message, recipientCount: recipients.length };
  }

  private timeStep<T>(
    timer: OperationTimer | undefined,
    step: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return timer ? timer.time(step, callback) : callback();
  }
}
