/**
 * Notifications module presenter service.
 * It shapes a notification record with its actor into the plain object returned to clients.
 *
 * Calls: NotificationWithActor
 * Used by:
 *   - src/modules/notifications/notifications.module.ts
 *   - src/modules/notifications/services/notifications.service.ts
 */

import { Injectable } from '@nestjs/common';
import { NotificationWithActor } from '../utils/notification.types';

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
