import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChatGateway } from '../chat/gateways/chat.gateway';
import { ChatMessageFanoutService } from '../chat/services/chat-message-fanout.service';
import { ChatService } from '../chat/services/chat.service';
import {
  ContractTemplateInput,
  NotificationTemplateService,
} from '../notifications/services/notification-template.service';
import { NotificationsService } from '../notifications/services/notifications.service';
import { RedisService } from '../redis/redis.service';
import { Side } from './contract-rules';
import { DeadlineRule } from './deadline-rules';

/** Why a contract ended early. */
export type EndReason =
  | 'FREELANCER_LATE'
  | 'CLIENT_SILENT'
  | 'NOT_FUNDED'
  | 'MUTUAL'
  | 'CLIENT_ENDED';

/**
 * Every kind of history row (ContractEvent.type) and the `data` it carries.
 * The frontend draws the timeline from these, so one list keeps both sides in step.
 * `undefined` as the whole value means the row has no data.
 */
export type ContractEventDataMap = {
  proposal_sent: { version: 1; total: number };
  proposal_countered: { version: number; total: number };
  proposal_accepted: { version: number };
  proposal_declined: { note?: string };
  proposal_withdrawn: undefined;
  proposal_expired: undefined;
  contract_started: { total: number };
  milestone_funded: { milestoneId: number; position: number; amount: number };
  work_submitted: {
    milestoneId: number;
    position: number;
    submission: number;
  };
  changes_requested: { milestoneId: number; position: number; note: string };
  milestone_approved: {
    milestoneId: number;
    position: number;
    amount: number;
    auto: boolean;
  };
  milestone_refunded: {
    milestoneId: number;
    position: number;
    amount: number;
  };
  milestone_cancelled: { milestoneId: number; position: number };
  warning_sent: { rule: DeadlineRule; milestoneId: number; position: number };
  amendment_proposed: { amendmentId: number };
  amendment_accepted: { amendmentId: number };
  amendment_declined: { amendmentId: number; note?: string };
  amendment_withdrawn: { amendmentId: number };
  end_requested: { note?: string; choice?: 'APPROVE' | 'REFUND' };
  end_request_declined: undefined;
  end_request_withdrawn: undefined;
  contract_completed: undefined;
  contract_ended: { reason: EndReason };
  review_left: { rating: number };
  imported: { hireId: number };
};

export type ContractEventType = keyof ContractEventDataMap;

/** One history row: it belongs to a proposal, a contract, or both. */
export type ContractEventInput = {
  [T in ContractEventType]: {
    proposalId?: number;
    contractId?: number;
    /** Null when the system (sweeper, import) did it. */
    actorId: number | null;
    type: T;
  } & (undefined extends ContractEventDataMap[T]
    ? { data?: ContractEventDataMap[T] }
    : { data: ContractEventDataMap[T] });
}[ContractEventType];

export type ContractAnnounceInput = {
  recipientId: number;
  /** Null for sweeper steps (no person acted). */
  actorId: number | null;
  actorName: string;
  /** proposal: PROPOSAL_UPDATE, contract: CONTRACT_UPDATE. */
  kind: 'proposal' | 'contract';
  step: ContractEventType;
  title: string;
  body: string;
  proposalId?: number;
  contractId?: number;
  milestoneId?: number;
  /** Which side the recipient is; it picks the tab in the link. */
  recipientSide: Side;
  /**
   * A line for the direct chat of the pair. It is sent AS `fromId` (the person who acted).
   * Sweeper lines come from the client and start with "JobAura:".
   */
  chat?: { fromId: number; toId: number; text: string };
};

@Injectable()
export class ContractEventsService {
  private readonly logger = new Logger('ContractEventsService');

  constructor(
    private readonly notifications: NotificationsService,
    private readonly templates: NotificationTemplateService,
    private readonly chatService: ChatService,
    private readonly messageFanout: ChatMessageFanoutService,
    private readonly chatGateway: ChatGateway,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Save one history row. It runs inside the caller's transaction (tx = a group of database
   * changes that are saved together or not at all), so the row exists only if the change does.
   */
  async record(
    tx: Prisma.TransactionClient,
    event: ContractEventInput,
  ): Promise<void> {
    await tx.contractEvent.create({
      data: {
        ...(event.proposalId !== undefined
          ? { proposalId: event.proposalId }
          : {}),
        ...(event.contractId !== undefined
          ? { contractId: event.contractId }
          : {}),
        actorId: event.actorId,
        type: event.type,
        ...(event.data !== undefined
          ? { data: event.data as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  /**
   * Tell the other side what happened: one notification, plus a chat line when `chat` is given.
   * It runs after the transaction is saved (committed) and never throws: a failure is only
   * logged. The notification and the chat line are separate steps; one failing does not stop
   * the other.
   */
  async announce(input: ContractAnnounceInput): Promise<void> {
    const where = `${input.kind} ${input.proposalId ?? input.contractId} (${input.step})`;
    // A finished contract changes the freelancer's profile (completed jobs count), so the saved
    // (cached) profile is dropped. This was done by the old hires service. It never blocks the rest.
    if (input.step === 'contract_completed') {
      try {
        await this.redisService.invalidateUserCaches(input.recipientId);
      } catch (error) {
        this.logger.error(
          `Profile cache clear failed for ${where}: ${this.errorText(error)}`,
        );
      }
    }
    try {
      const templateInput: ContractTemplateInput = {
        recipientId: input.recipientId,
        actorId: input.actorId,
        actorName: input.actorName,
        kind: input.kind,
        step: input.step,
        title: input.title,
        body: input.body,
        proposalId: input.proposalId,
        contractId: input.contractId,
        milestoneId: input.milestoneId,
        recipientSide: input.recipientSide,
      };
      await this.notifications.create(
        input.kind === 'proposal'
          ? this.templates.proposalUpdate(templateInput)
          : this.templates.contractUpdate(templateInput),
      );
    } catch (error) {
      this.logger.error(
        `Contract notification failed for ${where}: ${this.errorText(error)}`,
      );
    }

    if (!input.chat) return;
    try {
      const { fromId, toId, text } = input.chat;
      // createRoom gives back the existing direct room of the pair, or makes one.
      const room = await this.chatService.createRoom(fromId, {
        memberIds: [toId],
        isPrivate: true,
      });
      const { message } = await this.messageFanout.saveMessageAndNotify(
        fromId,
        { roomId: room.id, content: text },
      );
      this.chatGateway.broadcastNewMessage(room.id, message);
    } catch (error) {
      this.logger.error(
        `Contract chat line failed for ${where}: ${this.errorText(error)}`,
      );
    }
  }

  private errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
