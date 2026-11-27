/**
 * Request DTOs for the skill module. Validates query options for searching skills and the CV text payload for extracting skills.
 *
 * Calls: trimString; optionalTrimString
 * Used by:
 *   - src/modules/skill/controllers/skill.controller.ts
 */

import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export class SearchSkillsDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q: string;

  /** The user's ESCO occupation code; skills of that occupation are listed first (sent to the AI as `occupation`). */
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  field?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ExtractSkillsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  text: string;
}
