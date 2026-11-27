/**
 * Occupations module DTO that validates the optional search query and limit for occupation searches.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - src/modules/occupations/controllers/occupations.controller.ts
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
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class SearchOccupationsDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
