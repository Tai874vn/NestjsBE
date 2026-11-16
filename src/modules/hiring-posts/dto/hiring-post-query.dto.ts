import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export const HIRING_POST_LEVELS = ['Junior', 'Mid', 'Senior'] as const;

/** Filters a candidate uses to narrow open hiring posts. */
export class HiringPostQueryDto extends PaginationDto {
  /** ESCO occupation code; posts for that occupation. */
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  occupation?: string;

  @IsOptional()
  @IsIn(HIRING_POST_LEVELS)
  level?: (typeof HIRING_POST_LEVELS)[number];

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  employmentType?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;
}
