import { Transform, Type } from 'class-transformer';
import {
  IsArray,
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
import {
  commaList,
  optionalTrimString,
} from '../../../common/dto/string.transforms';

// @find candidates search search-in validation [recruiter] — the fields a keyword MAY be searched in (allowlist)
/** The fields the frontend may ask the keyword to be searched in (?searchIn=name,skills). Default: all. */
export const CANDIDATE_SEARCH_FIELDS = [
  'name',
  'headline',
  'bio',
  'location',
  'skills',
  'portfolio',
] as const;
export type CandidateSearchField = (typeof CANDIDATE_SEARCH_FIELDS)[number];

export class CandidateDirectoryQueryDto extends PaginationDto {
  @Transform(commaList)
  @IsOptional()
  @IsArray()
  @IsIn(CANDIDATE_SEARCH_FIELDS, {
    each: true,
    message: `searchIn must be some of: ${CANDIDATE_SEARCH_FIELDS.join(', ')}`,
  })
  searchIn?: CandidateSearchField[];

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
