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
