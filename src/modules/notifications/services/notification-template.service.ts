import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { CreateNotificationInput } from '../utils/notification.types';

/**
 * Input for the hiring pipeline notifications. `forRecruiter` picks the link: the recruiter
 * opens the applicants page of the post, the candidate opens My applications.
 */
export type HiringPipelineTemplateInput = {
  recipientId: number;
  actorId: number;
  title: string;
  body: string;
  applicationId: number;
  postId: number;
  forRecruiter: boolean;
  /** Extra facts for the metadata (extra data saved with the notification) so the app can write its own headline. */
  postTitle: string;
  /** Display name of the person who acted. */
  actorName: string;
  /** Which of the three hiring notifications this is. */
  kind: 'received' | 'application' | 'interview';
  /** ISO UTC time of a booked interview, when known. */
  scheduledAt?: string;
  /** ISO UTC times offered for an interview, when known. */
  proposedTimes?: string[];
};

/**
 * Input for the proposal and contract notifications. `recipientSide` picks the tab of the
 * link on the Contracts page (the client tab or the freelancer tab).
 */
export type ContractTemplateInput = {
  recipientId: number;
  /** Null when the system (sweeper) acted. */
  actorId: number | null;
  actorName: string;
  kind: 'proposal' | 'contract';
  /** The event name, for example proposal_sent or milestone_funded. */
  step: string;
  title: string;
  body: string;
  proposalId?: number;
  contractId?: number;
  milestoneId?: number;
  /** The service (job) title, so the headline can name it. */
  jobTitle?: string;
  /** Milestone number when the step is about one milestone. */
  position?: number;
  /** Credits that moved (held, released or refunded). */
  amount?: number;
  /** Sweeper rule or end reason. */
  rule?: string;
  recipientSide: 'client' | 'freelancer';
};

@Injectable()
export class NotificationTemplateService {
  connectionRequest(input: {
    requesterId: number;
    recipientId: number;
    connectionId: number;
  }): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.requesterId,
      type: NotificationType.CONNECTION_REQUEST,
      title: 'New connection request',
      body: 'sent you a connection request.',
      entityType: 'connection',
      entityId: input.connectionId,
      actionUrl: '/connections',
      metadata: { connectionId: input.connectionId },
      dedupeKey: `connection_request:${input.connectionId}`,
    };
  }

  connectionAccepted(input: {
    accepterId: number;
    requesterId: number;
    connectionId: number;
  }): CreateNotificationInput {
    return {
      recipientId: input.requesterId,
      actorId: input.accepterId,
      type: NotificationType.CONNECTION_ACCEPTED,
      title: 'Connection accepted',
      body: 'accepted your connection request.',
      entityType: 'connection',
      entityId: input.connectionId,
      actionUrl: '/connections',
      metadata: { connectionId: input.connectionId },
      dedupeKey: `connection_accepted:${input.connectionId}`,
    };
  }

  postLike(input: {
    actorId: number;
    recipientId: number;
    postId: number;
    postTitle?: string;
  }): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.POST_LIKE,
      title: 'New reaction',
      body: 'liked your post.',
      entityType: 'post',
      entityId: input.postId,
      actionUrl: `/?postId=${input.postId}`,
      metadata: {
        postId: input.postId,
        postTitle: this.preview(input.postTitle ?? '', 'Post'),
      },
      dedupeKey: `post_like:${input.postId}:${input.actorId}`,
    };
  }

  postComment(input: {
    actorId: number;
    recipientId: number;
    postId: number;
    commentId: number;
    parentCommentId?: number;
    preview: string;
    postTitle?: string;
  }): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.POST_COMMENT,
      title: input.parentCommentId ? 'New reply' : 'New comment',
      body: this.preview(
        input.preview,
        input.parentCommentId
          ? 'replied to your comment.'
          : 'commented on your post.',
      ),
      entityType: 'post_comment',
      entityId: input.commentId,
      actionUrl: `/?postId=${input.postId}`,
      metadata: {
        postId: input.postId,
        commentId: input.commentId,
        ...(input.parentCommentId
          ? { parentCommentId: input.parentCommentId }
          : {}),
        postTitle: this.preview(input.postTitle ?? '', 'Post'),
      },
    };
  }

  chatMessage(input: {
    senderId: number;
    recipientId: number;
    unreadCount: number;
    roomId: number;
    messageId: number;
  }): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.senderId,
      type: NotificationType.CHAT_MESSAGE,
      title: 'New messages',
      body: this.chatMessageBody(input.unreadCount),
      entityType: 'chat_message',
      entityId: input.messageId,
      actionUrl: null,
      metadata: {
        roomId: input.roomId,
        messageId: input.messageId,
        unreadCount: input.unreadCount,
      },
      dedupeKey: `chat_message:${input.roomId}:${input.recipientId}`,
    };
  }

  /** A candidate applied to the recruiter's hiring post. */
  applicationReceived(input: HiringPipelineTemplateInput) {
    return this.hiringPipeline(NotificationType.APPLICATION_RECEIVED, input);
  }

  /** An application changed (shortlisted, offer sent, offer accepted, withdrawn, ...). */
  applicationUpdate(input: HiringPipelineTemplateInput) {
    return this.hiringPipeline(NotificationType.APPLICATION_UPDATE, input);
  }

  /** An interview changed (requested, time picked, new times, cancelled, ...). */
  interviewUpdate(input: HiringPipelineTemplateInput) {
    return this.hiringPipeline(NotificationType.INTERVIEW_UPDATE, input);
  }

  /**
   * Shared shape for the three hiring pipeline notifications.
   * No dedupeKey (a key that merges repeated notifications into one): every step of the
   * pipeline should show as its own notification in the bell.
   */
  private hiringPipeline(
    type: NotificationType,
    input: HiringPipelineTemplateInput,
  ): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type,
      title: input.title,
      body: input.body,
      entityType: 'hiring_application',
      entityId: input.applicationId,
      actionUrl: input.forRecruiter
        ? `/my-hiring-posts/${input.postId}/applicants?application=${input.applicationId}`
        : `/my-applications?application=${input.applicationId}`,
      metadata: {
        applicationId: input.applicationId,
        postId: input.postId,
        postTitle: input.postTitle,
        actorName: input.actorName,
        kind: input.kind,
        // Times are added only when the caller knows them.
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.proposedTimes ? { proposedTimes: input.proposedTimes } : {}),
      },
    };
  }

  /** A proposal changed (sent, countered, accepted, declined, ...). Links to the proposal. */
  proposalUpdate(input: ContractTemplateInput): CreateNotificationInput {
    return this.contractShape(NotificationType.PROPOSAL_UPDATE, input);
  }

  /** A contract changed (funded, submitted, approved, ended, ...). Links to the contract. */
  contractUpdate(input: ContractTemplateInput): CreateNotificationInput {
    return this.contractShape(NotificationType.CONTRACT_UPDATE, input);
  }

  /**
   * Shared shape of both notifications. No dedupeKey: every step shows as its own row.
   * Ids that do not apply are saved as null so the metadata always has the same keys.
   */
  private contractShape(
    type: NotificationType,
    input: ContractTemplateInput,
  ): CreateNotificationInput {
    const proposal = input.kind === 'proposal';
    const id = (proposal ? input.proposalId : input.contractId) as number;
    return {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type,
      title: input.title,
      body: input.body,
      entityType: proposal ? 'proposal' : 'contract',
      entityId: id,
      actionUrl: `/contracts?tab=${input.recipientSide}&${proposal ? 'proposal' : 'contract'}=${id}`,
      metadata: {
        kind: input.kind,
        step: input.step,
        proposalId: input.proposalId ?? null,
        contractId: input.contractId ?? null,
        milestoneId: input.milestoneId ?? null,
        jobTitle: input.jobTitle ?? null,
        position: input.position ?? null,
        amount: input.amount ?? null,
        rule: input.rule ?? null,
        actorName: input.actorName,
        title: input.title,
      },
    };
  }

  private preview(value: string, fallback: string) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) return fallback;
    return normalized.length > 120
      ? `${normalized.slice(0, 117)}...`
      : normalized;
  }

  private chatMessageBody(unreadCount: number) {
    const safeCount = Math.max(1, unreadCount);
    return safeCount === 1 ? '1 new message' : `${safeCount} new messages`;
  }
}
