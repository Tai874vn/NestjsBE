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
