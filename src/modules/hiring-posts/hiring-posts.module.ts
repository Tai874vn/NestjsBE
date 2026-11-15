import { Module } from '@nestjs/common';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { HiringPostsController } from './controllers/hiring-posts.controller';
import { HiringPostAiQueueService } from './services/hiring-post-ai-queue.service';
import { HiringPostsService } from './services/hiring-posts.service';

@Module({
  imports: [RecommendationsModule],
  controllers: [HiringPostsController],
  providers: [HiringPostsService, HiringPostAiQueueService],
  exports: [HiringPostsService],
})
export class HiringPostsModule {}
