import { Module } from '@nestjs/common';
import { JobsService } from './services/jobs.service';
import { JobCacheInvalidationService } from './services/job-cache-invalidation.service';
import { JobCatalogService } from './services/job-catalog.service';
import { JobMutationService } from './services/job-mutation.service';
import { JobSearchService } from './services/job-search.service';
import { JobsController } from './controllers/jobs.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [JobsController],
  providers: [
    JobsService,
    JobCacheInvalidationService,
    JobCatalogService,
    JobMutationService,
    JobSearchService,
    PrismaService,
  ],
  exports: [JobsService],
})
export class JobsModule {}
