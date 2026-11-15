import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { CAREER_FIELDS } from '../../../common/career-fields';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export const HIRING_POST_LEVELS = ['Junior', 'Mid', 'Senior'] as const;

/** Filters a candidate uses to narrow open hiring posts. */
export class HiringPostQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(CAREER_FIELDS)
  careerField?: string;

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
