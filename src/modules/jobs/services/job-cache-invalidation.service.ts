/**
 * Cache invalidation helper for the jobs module. Clears cached job and user data in Redis after a job changes.
 *
 * Calls: RedisService
 * Used by:
 *   - src/modules/jobs/jobs.module.ts
 *   - src/modules/jobs/services/job-mutation.service.ts
 */

import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/services/redis.service';

@Injectable()
export class JobCacheInvalidationService {
  constructor(private readonly redisService: RedisService) {}

  async invalidateJobMutation(userId: number, jobId?: number) {
    await this.redisService.invalidateJobCaches(jobId);
    await this.redisService.invalidateUserCaches(userId);
  }
}
