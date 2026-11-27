/**
 * Request body DTO for updating a job category in the categories module.
 * It validates and trims the optional category name.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - src/modules/categories/controllers/categories.controller.ts
 *   - src/modules/categories/services/categories.service.ts
 */

import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class UpdateCategoryDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
