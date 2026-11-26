import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApplicationPipelineService } from './services/application-pipeline.service';
import { ApplicationsQueryService } from './services/applications-query.service';
import { ApplicationsService } from './services/applications.service';
import { ApplicationsController } from './controllers/applications.controller';
import { InterviewsController } from './controllers/interviews.controller';
import { HiringEventsService } from './services/hiring-events.service';
import { InterviewsService } from './services/interviews.service';
import { PostSweepService } from './services/post-sweep.service';
import { VideoCallService } from './services/video-call.service';

/**
 * Hiring pipeline: applications → interviews → offers → hired.
 * It has the history rows, notifications and chat messages (HiringEventsService), the sweep of a
 * closing post (PostSweepService), the shared lock-check-write-tell steps (ApplicationPipelineService),
 * the application detail and actions (ApplicationsService and ApplicationsQueryService, answered over
 * HTTP by ApplicationsController), and the interviews (InterviewsService, InterviewsController) with their video call tokens
 * (VideoCallService).
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
    VideoCallService,
  ],
  exports: [HiringEventsService, PostSweepService],
})
export class HiringPipelineModule {}
