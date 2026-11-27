/**
 * Query DTO for cursor-based job pagination in the jobs module. Extends JobSearchQueryDto with an optional cursor token and page size limit.
 *
 * Calls: JobSearchQueryDto; optionalTrimString
 * Used by:
 *   - src/modules/jobs/controllers/jobs.controller.ts
 *   - src/modules/jobs/services/job-search.service.ts
 *   - src/modules/jobs/services/jobs.service.ts
 */

import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JobSearchQueryDto } from './job-search-query.dto';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class JobCursorQueryDto extends JobSearchQueryDto {
  @IsOptional()
  @Transform(optionalTrimString)
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
