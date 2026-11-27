/**
 * Common query DTO (`PaginationDto`) used by paginated search and list endpoints.
 * Validates optional `page` (default 1), `pageSize` (1 to 100, default 10), and a trimmed `keyword` up to 80 characters.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - 15 files, for example src/modules/categories/controllers/categories.controller.ts, src/modules/categories/services/categories.service.ts, src/modules/hiring-posts/controllers/hiring-posts.controller.ts
 */

import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { optionalTrimString } from './string.transforms';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @IsOptional()
  @Transform(optionalTrimString)
  @IsString()
  @MaxLength(80)
  // @find shared search keyword validation [all] — every keyword box: trimmed, text, max 80 characters
  keyword?: string;
}
