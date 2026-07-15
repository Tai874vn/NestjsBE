import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { RecommendationsController } from './controllers/recommendations.controller';
import { AiRecommendationClient } from './services/ai-recommendation.client';
import { RecommendationCacheService } from './services/recommendation-cache.service';
import { RecommendationPayloadMapperService } from './services/recommendation-payload-mapper.service';
import { RecommendationQuotaService } from './services/recommendation-quota.service';
import { RecommendationScoringService } from './services/recommendation-scoring.service';
import { RecommendationsService } from './services/recommendations.service';

@Module({
  imports: [ConfigModule, ObservabilityModule],
  controllers: [RecommendationsController],
  providers: [
    AiRecommendationClient,
    RecommendationCacheService,
    RecommendationPayloadMapperService,
    RecommendationQuotaService,
    RecommendationScoringService,
    RecommendationsService,
    PrismaService,
  ],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
