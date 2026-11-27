/**
 * NestJS module for the jobs feature. Imports NotificationsModule, registers JobsController, provides JobsService, JobCacheInvalidationService, JobCatalogService, JobMutationService, and JobSearchService, and exports JobsService.
 *
 * Calls: NotificationsModule; JobsController; JobsService; JobCacheInvalidationService; JobCatalogService; JobMutationService; JobSearchService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { JobsService } from './services/jobs.service';
import { JobCacheInvalidationService } from './services/job-cache-invalidation.service';
import { JobCatalogService } from './services/job-catalog.service';
import { JobMutationService } from './services/job-mutation.service';
import { JobSearchService } from './services/job-search.service';
import { JobsController } from './controllers/jobs.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // Notifications: tell the other person of an open proposal when its service is deleted.
  imports: [NotificationsModule],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobCacheInvalidationService,
    JobCatalogService,
    JobMutationService,
    JobSearchService,
  ],
  exports: [JobsService],
})
export class JobsModule {}
