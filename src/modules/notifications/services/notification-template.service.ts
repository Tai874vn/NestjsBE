import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { CreateNotificationInput } from './notification.types';

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
    preview: string;
    postTitle?: string;
  }): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.POST_COMMENT,
      title: 'New comment',
      body: this.preview(input.preview, 'commented on your post.'),
      entityType: 'post_comment',
      entityId: input.commentId,
      actionUrl: `/?postId=${input.postId}`,
      metadata: {
        postId: input.postId,
        commentId: input.commentId,
        postTitle: this.preview(input.postTitle ?? '', 'Post'),
      },
    };
  }

  hireCreated(input: {
    hirerId: number;
    recipientId: number;
    hireId: number;
    jobId: number;
    jobTitle: string;
  }): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.hirerId,
      type: NotificationType.HIRE_CREATED,
      title: 'New hire',
      body: `hired ${input.jobTitle}.`,
      entityType: 'hire',
      entityId: input.hireId,
      actionUrl: `/jobs/${input.jobId}`,
      metadata: { hireId: input.hireId, jobId: input.jobId },
      dedupeKey: `hire_created:${input.hireId}`,
    };
  }

  hireCompleted(input: {
    actorId: number;
    recipientId: number;
    hireId: number;
    jobId: number;
    jobTitle: string;
  }): CreateNotificationInput {
    return {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: NotificationType.HIRE_COMPLETED,
      title: 'Work completed',
      body: `marked ${input.jobTitle} as complete.`,
      entityType: 'hire',
      entityId: input.hireId,
      actionUrl: `/jobs/${input.jobId}`,
      metadata: { hireId: input.hireId, jobId: input.jobId },
      dedupeKey: `hire_completed:${input.hireId}`,
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
