/**
 * Records timeline history rows and sends post-commit notifications and chat messages for the hiring-pipeline module.
 * Keeps notification and chat delivery separate and reports delivery failures to Sentry without failing the user action.
 *
 * Calls: prisma.hiringApplicationEvent; NotificationsService; NotificationTemplateService; ChatService; ChatMessageFanoutService; ChatGateway; Sentry
 * Used by:
 *   - 8 files, for example src/modules/hiring-pipeline/hiring-pipeline.module.ts, src/modules/hiring-pipeline/services/application-pipeline.service.ts, src/modules/hiring-pipeline/services/applications.service.ts
 */

import { Injectable, Logger } from '@nestjs/common';
import { InterviewMode, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { ChatGateway } from '../../chat/gateways/chat.gateway';
import { ChatMessageFanoutService } from '../../chat/services/chat-message-fanout.service';
import { ChatService } from '../../chat/services/chat.service';
import {
  HiringPipelineTemplateInput,
  NotificationTemplateService,
} from '../../notifications/services/notification-template.service';
import { NotificationsService } from '../../notifications/services/notifications.service';

/**
 * Every kind of history row (HiringApplicationEvent.type) and the `data` it carries.
 * The frontend draws the application's timeline from these, so one list keeps both sides in step.
 * A key with `?` may be left out; `undefined` as the whole value means the row has no data.
 */
export type HiringEventDataMap = {
  applied: undefined;
  reapplied: undefined;
  shortlisted: undefined;
  /** reason: why the post rejected everyone (a "sweep"); null when the recruiter chose to reject. */
  rejected: {
    reason: 'POSITION_FILLED' | 'POST_CLOSED' | null;
    note?: string;
  };
  offer_sent: { note: string } | undefined;
  offer_withdrawn: undefined;
  hired: undefined;
  offer_declined: { note: string } | undefined;
  withdrawn: undefined;
  interview_requested: {
    interviewId: number;
    round: number;
    mode: InterviewMode;
    /** ISO date-time strings (for example 2026-11-23T09:00:00.000Z). */
    proposedTimes: string[];
  };
  interview_times_proposed: { interviewId: number; proposedTimes: string[] };
  interview_booked: { interviewId: number; scheduledAt: string };
  interview_reschedule_requested: { interviewId: number; note?: string };
  /**
   * by: who cancelled. 'system' is the sweep (the post closed or filled), and then `reason` says why.
   * Rejecting cancels the interview as 'recruiter'; withdrawing cancels it as 'candidate'.
   */
  interview_cancelled: {
    interviewId: number;
    by: 'recruiter' | 'candidate' | 'system';
    reason?: 'POSITION_FILLED' | 'POST_CLOSED';
    note?: string;
  };
  interview_completed: { interviewId: number };
};

/** The names of all history rows: applied, reapplied, shortlisted, rejected, offer_sent, ... */
export type HiringEventType = keyof HiringEventDataMap;

/** One row of the application's history (who did what, and when), with the data its type carries. */
export type PipelineEvent = {
  [T in HiringEventType]: {
    applicationId: number;
    actorId: number | null;
    type: T;
  } & (undefined extends HiringEventDataMap[T]
    ? { data?: HiringEventDataMap[T] }
    : { data: HiringEventDataMap[T] });
}[HiringEventType];

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
  /** Title of the hiring post (goes into the notification metadata, so the app can write its own headline). */
  postTitle: string;
  /** Display name of the person who acted. */
  actorName: string;
  /** ISO UTC time of the booked interview (only when an interview is booked). */
  scheduledAt?: string;
  /** ISO UTC times offered for the interview (only when an interview is requested or new times are sent). */
  proposedTimes?: string[];
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
    await tx.hiringApplicationEvent.create({ data: this.row(event) });
  }

  /**
   * Save many history rows in one database call (createMany), inside the caller's transaction.
   * Used by the sweep, which may reject many applications at once. An empty list writes nothing.
   */
  async recordMany(
    tx: Prisma.TransactionClient,
    events: PipelineEvent[],
  ): Promise<void> {
    if (!events.length) return;
    await tx.hiringApplicationEvent.createMany({
      data: events.map((event) => this.row(event)),
    });
  }

  /** The database row of an event; `data` is left out when the event has none. */
  private row(event: PipelineEvent) {
    return {
      applicationId: event.applicationId,
      actorId: event.actorId,
      type: event.type,
      ...(event.data !== undefined
        ? { data: event.data as Prisma.InputJsonValue }
        : {}),
    };
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
      Sentry.captureException(error, {
        tags: { context: 'hiring-events.notification' },
      });
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
      Sentry.captureException(error, {
        tags: { context: 'hiring-events.chat' },
      });
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
      postTitle: input.postTitle,
      actorName: input.actorName,
      kind: input.kind,
      scheduledAt: input.scheduledAt,
      proposedTimes: input.proposedTimes,
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
