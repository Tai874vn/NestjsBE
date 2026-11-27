/**
 * NestJS module for the hiring-posts feature. Imports RecommendationsModule and HiringPipelineModule, registers HiringPostsController, provides HiringPostsService and HiringPostAiQueueService, and exports HiringPostsService.
 *
 * Calls: RecommendationsModule; HiringPipelineModule; HiringPostsController; HiringPostsService; HiringPostAiQueueService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { HiringPipelineModule } from '../hiring-pipeline/hiring-pipeline.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { HiringPostsController } from './controllers/hiring-posts.controller';
import { HiringPostAiQueueService } from './services/hiring-post-ai-queue.service';
import { HiringPostsService } from './services/hiring-posts.service';

@Module({
  imports: [RecommendationsModule, HiringPipelineModule],
  controllers: [HiringPostsController],
  providers: [HiringPostsService, HiringPostAiQueueService],
  exports: [HiringPostsService],
})
export class HiringPostsModule {}
