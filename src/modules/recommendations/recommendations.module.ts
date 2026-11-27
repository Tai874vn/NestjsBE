/**
 * NestJS module for the recommendations feature.
 * It imports ConfigModule and ObservabilityModule, registers RecommendationsController and all recommendation services, and exports AiRecommendationClient, RecommendationPayloadMapperService, and RecommendationsService.
 *
 * Calls: ConfigModule; ObservabilityModule; RecommendationsController; RecommendationsService; AiRecommendationClient; RecommendationPayloadMapperService; recommendation helper services (cache, loader, fingerprint, quota, scoring, snapshot)
 * Used by:
 *   - src/app.module.ts
 *   - src/modules/hiring-posts/hiring-posts.module.ts
 *   - src/modules/skill/skill.module.ts
 *   - src/modules/users/users.module.ts
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { RecommendationsController } from './controllers/recommendations.controller';
import { AiRecommendationClient } from './services/ai-recommendation.client';
import { RecommendationCacheService } from './services/recommendation-cache.service';
import { RecommendationDataLoaderService } from './services/recommendation-data-loader.service';
import { RecommendationFingerprintService } from './services/recommendation-fingerprint.service';
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
    RecommendationFingerprintService,
    RecommendationPayloadMapperService,
    RecommendationQuotaService,
    RecommendationScoringService,
    RecommendationSnapshotService,
    RecommendationsService,
  ],
  exports: [
    AiRecommendationClient,
    RecommendationPayloadMapperService,
    RecommendationsService,
  ],
})
export class RecommendationsModule {}
