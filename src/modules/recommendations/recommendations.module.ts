import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { RecommendationsController } from './controllers/recommendations.controller';
import { AiRecommendationClient } from './services/ai-recommendation.client';
import { RecommendationCacheService } from './services/recommendation-cache.service';
import { RecommendationDataLoaderService } from './services/recommendation-data-loader.service';
import { RecommendationPayloadMapperService } from './services/recommendation-payload-mapper.service';
import { RecommendationQuotaService } from './services/recommendation-quota.service';
import { RecommendationScoringService } from './services/recommendation-scoring.service';
import { RecommendationSnapshotService } from './services/recommendation-snapshot.service';
import { RecommendationsService } from './services/recommendations.service';

@Module({
  imports: [ConfigModule, ObservabilityModule],
  controllers: [RecommendationsController],
  providers: [
    AiRecommendationClient,
    RecommendationCacheService,
    RecommendationDataLoaderService,
    RecommendationPayloadMapperService,
    RecommendationQuotaService,
    RecommendationScoringService,
    RecommendationSnapshotService,
    RecommendationsService,
    PrismaService,
  ],
  exports: [
    AiRecommendationClient,
    RecommendationPayloadMapperService,
    RecommendationsService,
  ],
})
export class RecommendationsModule {}
