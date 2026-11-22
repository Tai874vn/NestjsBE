import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HiringEventsService } from './hiring-events.service';
import { PostSweepService } from './post-sweep.service';

/**
 * Hiring pipeline: applications → interviews → offers → hired.
 * For now it has the history rows, notifications and chat messages (HiringEventsService) and the
 * sweep of a closing post (PostSweepService);
 * later tasks add the services and controllers (the classes that answer HTTP requests).
 */
@Module({
  imports: [NotificationsModule, ChatModule],
  providers: [HiringEventsService, PostSweepService],
  exports: [HiringEventsService, PostSweepService],
})
export class HiringPipelineModule {}
