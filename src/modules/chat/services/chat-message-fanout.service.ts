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

    const recipients = await this.timeStep(timer, 'db.unreadCounts', () =>
      Promise.all(
        recipientIds.map(async (recipientId) => ({
          recipientId,
          unreadCount: await this.chatService.getUnreadCount(
            dto.roomId,
            recipientId,
          ),
        })),
      ),
    );

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
