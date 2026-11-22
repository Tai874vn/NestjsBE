import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HiringEventsService } from './hiring-events.service';

/**
 * Hiring pipeline: applications → interviews → offers → hired.
 * For now it only has the history rows, notifications and chat messages (HiringEventsService);
 * later tasks add the services and controllers (the classes that answer HTTP requests).
 */
@Module({
  imports: [NotificationsModule, ChatModule],
  providers: [HiringEventsService],
  exports: [HiringEventsService],
})
export class HiringPipelineModule {}
