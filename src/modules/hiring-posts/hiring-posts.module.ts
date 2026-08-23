import { Module } from '@nestjs/common';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { HiringPostsController } from './controllers/hiring-posts.controller';
import { HiringPostsService } from './services/hiring-posts.service';

@Module({
  imports: [RecommendationsModule],
  controllers: [HiringPostsController],
  providers: [HiringPostsService],
  exports: [HiringPostsService],
})
export class HiringPostsModule {}
