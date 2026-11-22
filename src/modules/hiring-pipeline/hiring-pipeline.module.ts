import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApplicationsQueryService } from './applications-query.service';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './controllers/applications.controller';
import { HiringEventsService } from './hiring-events.service';
import { PostSweepService } from './post-sweep.service';

/**
 * Hiring pipeline: applications → interviews → offers → hired.
 * It has the history rows, notifications and chat messages (HiringEventsService), the sweep of a
 * closing post (PostSweepService), and the application detail and actions (ApplicationsService and
 * ApplicationsQueryService, answered over HTTP by ApplicationsController).
 */
@Module({
  imports: [NotificationsModule, ChatModule],
  controllers: [ApplicationsController],
  providers: [
    HiringEventsService,
    PostSweepService,
    ApplicationsService,
    ApplicationsQueryService,
  ],
  exports: [HiringEventsService, PostSweepService],
})
export class HiringPipelineModule {}
