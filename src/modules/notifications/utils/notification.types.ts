/**
 * Notifications module types and shared Prisma actor select shape.
 * It exports notificationActorSelect, NotificationWithActor, and CreateNotificationInput.
 *
 * Calls: Prisma NotificationType and Prisma types
 * Used by:
 *   - prisma/seed-activity.ts
 *   - src/modules/notifications/services/notification-presenter.service.ts
 *   - src/modules/notifications/services/notification-template.service.ts
 *   - src/modules/notifications/services/notifications.service.ts
 */

import { NotificationType, Prisma } from '@prisma/client';

export const notificationActorSelect = {
  id: true,
  name: true,
  avatar: true,
  headline: true,
} as const;

export type NotificationWithActor = Prisma.NotificationGetPayload<{
  include: { actor: { select: typeof notificationActorSelect } };
}>;

export type CreateNotificationInput = {
  recipientId: number;
  actorId?: number | null;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: number;
  actionUrl?: string | null;
  metadata?: Prisma.InputJsonValue;
  dedupeKey?: string;
};
