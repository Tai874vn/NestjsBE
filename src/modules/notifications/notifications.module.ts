/**
 * NestJS module for the notifications feature.
 * It imports ObservabilityModule and AuthModule, registers NotificationsController, NotificationsGateway, NotificationsService, NotificationPresenterService, and NotificationTemplateService, and exports NotificationsService and NotificationTemplateService.
 *
 * Calls: ObservabilityModule; AuthModule; NotificationsController; NotificationsGateway; NotificationsService; NotificationPresenterService; NotificationTemplateService
 * Used by:
 *   - 7 files, for example src/app.module.ts, src/modules/chat/chat.module.ts, src/modules/connections/connections.module.ts
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { NotificationPresenterService } from './services/notification-presenter.service';
import { NotificationTemplateService } from './services/notification-template.service';
import { NotificationsService } from './services/notifications.service';

@Module({
  imports: [ObservabilityModule, AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationPresenterService,
    NotificationTemplateService,
    NotificationsService,
    NotificationsGateway,
  ],
  exports: [NotificationsService, NotificationTemplateService],
})
export class NotificationsModule {}
