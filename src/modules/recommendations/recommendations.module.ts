import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { RecommendationsController } from './controllers/recommendations.controller';
import { AiRecommendationClient } from './services/ai-recommendation.client';
import { RecommendationScoringService } from './services/recommendation-scoring.service';
import { RecommendationsService } from './services/recommendations.service';

@Module({
  imports: [ConfigModule],
  controllers: [RecommendationsController],
  providers: [AiRecommendationClient, RecommendationScoringService, RecommendationsService, PrismaService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
