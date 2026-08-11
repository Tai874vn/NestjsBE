import { Injectable } from '@nestjs/common';
import { NotificationWithActor } from './notification.types';

@Injectable()
export class NotificationPresenterService {
  format(notification: NotificationWithActor) {
    return {
      id: notification.id,
      recipientId: notification.recipientId,
      actorId: notification.actorId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      entityType: notification.entityType,
      entityId: notification.entityId,
      actionUrl: notification.actionUrl,
      metadata: notification.metadata,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      actor: notification.actor,
    };
  }
}
