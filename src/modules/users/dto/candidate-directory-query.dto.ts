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

  /** ESCO occupation code: candidates whose resume names it as their main occupation. */
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  occupation?: string;

  /** With `occupation`, also candidates whose main occupation is in its related list. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeRelated?: boolean;

  /** The level the AI read from the candidate's resume. */
  @IsOptional()
  @IsIn(['Junior', 'Mid', 'Senior'])
  level?: string;

  /**
   * Minimum years in the candidate's main occupation, as saved with the AI prediction (the years the shown
   * level was decided on, the same value the card shows). A resume with no prediction never passes.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(40)
  minYears?: number;
}
