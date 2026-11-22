import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApplicationPipelineService } from './application-pipeline.service';
import { ApplicationsQueryService } from './applications-query.service';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './controllers/applications.controller';
import { InterviewsController } from './controllers/interviews.controller';
import { HiringEventsService } from './hiring-events.service';
import { InterviewsService } from './interviews.service';
import { PostSweepService } from './post-sweep.service';

/**
 * Hiring pipeline: applications → interviews → offers → hired.
 * It has the history rows, notifications and chat messages (HiringEventsService), the sweep of a
 * closing post (PostSweepService), the shared lock-check-write-tell steps (ApplicationPipelineService),
 * the application detail and actions (ApplicationsService and ApplicationsQueryService, answered over
 * HTTP by ApplicationsController), and the interviews (InterviewsService, InterviewsController).
 */
@Module({
  imports: [NotificationsModule, ChatModule],
  controllers: [ApplicationsController, InterviewsController],
  providers: [
    HiringEventsService,
    PostSweepService,
    ApplicationPipelineService,
    ApplicationsService,
    ApplicationsQueryService,
    InterviewsService,
  ],
  exports: [HiringEventsService, PostSweepService],
})
export class HiringPipelineModule {}
