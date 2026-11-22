import { HiringApplicationStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Query of the recruiter's applicants page: the page, and optionally one status to show. */
export class PostApplicationsQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(HiringApplicationStatus)
  status?: HiringApplicationStatus;
}
