import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChatGateway } from '../chat/gateways/chat.gateway';
import { ChatMessageFanoutService } from '../chat/services/chat-message-fanout.service';
import { ChatService } from '../chat/services/chat.service';
import {
  HiringPipelineTemplateInput,
  NotificationTemplateService,
} from '../notifications/services/notification-template.service';
import { NotificationsService } from '../notifications/services/notifications.service';

/** One row of the application's history (who did what, and when). */
export type PipelineEvent = {
  applicationId: number;
  actorId: number | null;
  type: string;
  data?: Prisma.InputJsonValue;
};

/**
 * Which notification type to send:
 * - received: a new application (APPLICATION_RECEIVED)
 * - application: the application changed (APPLICATION_UPDATE)
 * - interview: an interview changed (INTERVIEW_UPDATE)
 */
export type AnnounceKind = 'received' | 'application' | 'interview';

export type AnnounceInput = {
  recipientId: number;
  actorId: number;
  kind: AnnounceKind;
  title: string;
  body: string;
  applicationId: number;
  postId: number;
  /** true: the recipient is the recruiter (link to the applicants page). */
  forRecruiter: boolean;
  /** Text of a chat message to post in the direct chat room, if any. */
  chat?: string;
  /**
   * The two people of the chat message. The message is always sent BY the recruiter, so we
   * name both sides here instead of guessing from actorId / recipientId (for example, when
   * the candidate acts, the actor is the candidate, but such steps never send chat).
   * `chat` is only sent when this is given too.
   */
  chatBetween?: { recruiterId: number; candidateId: number };
};

@Injectable()
export class HiringEventsService {
  private readonly logger = new Logger('HiringEventsService');

  constructor(
    private readonly notifications: NotificationsService,
    private readonly templates: NotificationTemplateService,
    private readonly chatService: ChatService,
    private readonly messageFanout: ChatMessageFanoutService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Save one history row. It runs inside the caller's transaction (tx = a group of database
   * changes that are saved together or not at all), so the row exists only if the change does.
   */
  async record(
    tx: Prisma.TransactionClient,
    event: PipelineEvent,
  ): Promise<void> {
    await tx.hiringApplicationEvent.create({
      data: {
        applicationId: event.applicationId,
        actorId: event.actorId,
        type: event.type,
        ...(event.data !== undefined ? { data: event.data } : {}),
      },
    });
  }

  /**
   * Tell the other side what happened: one notification, plus a chat message when `chat` is
   * given. It runs after the transaction is saved (committed), so it never throws: a failed
   * notification or chat message is only logged and must not fail the user's action.
   * The notification and the chat message are separate steps; one failing does not stop the other.
   */
  async announce(input: AnnounceInput): Promise<void> {
    try {
      await this.notifications.create(this.buildNotification(input));
    } catch (error) {
      this.logger.error(
        `Hiring notification failed for application ${input.applicationId}: ${this.errorText(error)}`,
      );
    }

    if (!input.chat || !input.chatBetween) return;
    try {
      const { recruiterId, candidateId } = input.chatBetween;
      // createRoom gives back the existing direct room of the pair, or makes one.
      const room = await this.chatService.createRoom(recruiterId, {
        memberIds: [candidateId],
        isPrivate: true,
      });
      const { message } = await this.messageFanout.saveMessageAndNotify(
        recruiterId,
        { roomId: room.id, content: input.chat },
      );
      this.chatGateway.broadcastNewMessage(room.id, message);
    } catch (error) {
      this.logger.error(
        `Hiring chat message failed for application ${input.applicationId}: ${this.errorText(error)}`,
      );
    }
  }

  private buildNotification(input: AnnounceInput) {
    const templateInput: HiringPipelineTemplateInput = {
      recipientId: input.recipientId,
      actorId: input.actorId,
      title: input.title,
      body: input.body,
      applicationId: input.applicationId,
      postId: input.postId,
      forRecruiter: input.forRecruiter,
    };
    switch (input.kind) {
      case 'received':
        return this.templates.applicationReceived(templateInput);
      case 'application':
        return this.templates.applicationUpdate(templateInput);
      case 'interview':
        return this.templates.interviewUpdate(templateInput);
    }
  }

  private errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
