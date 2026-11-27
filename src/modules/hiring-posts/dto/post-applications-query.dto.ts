/**
 * Query DTO for listing applicants on a hiring post in the hiring-posts module. Extends pagination with an optional application status filter.
 *
 * Calls: PaginationDto
 * Used by:
 *   - src/modules/hiring-posts/controllers/hiring-posts.controller.ts
 *   - src/modules/hiring-posts/services/hiring-posts.service.ts
 */

import { HiringApplicationStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Query of the recruiter's applicants page: the page, and optionally one status to show. */
export class PostApplicationsQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(HiringApplicationStatus)
  status?: HiringApplicationStatus;
}
