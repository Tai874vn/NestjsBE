/**
 * Request body DTO for creating a job category in the categories module.
 * It validates and trims the category name.
 *
 * Calls: trimString
 * Used by:
 *   - src/modules/categories/controllers/categories.controller.ts
 *   - src/modules/categories/services/categories.service.ts
 */

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../../common/dto/string.transforms';

export class CreateCategoryDto {
  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;
}
