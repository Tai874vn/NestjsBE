import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CAREER_FIELDS } from '../../../common/career-fields';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class CandidateDirectoryQueryDto extends PaginationDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  skill?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasPortfolio?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasCertification?: boolean;

  /** The field the candidate chose on their resume (one of the 37). */
  @IsOptional()
  @IsIn(CAREER_FIELDS)
  careerField?: string;

  /** The level the AI read from the candidate's resume. */
  @IsOptional()
  @IsIn(['Junior', 'Mid', 'Senior'])
  level?: string;

  /** Minimum years in the candidate's field, from their resume's dated jobs. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(40)
  minYears?: number;
}
