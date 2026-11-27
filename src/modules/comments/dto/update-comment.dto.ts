/**
 * Request body DTO for editing a review in the comments module.
 * It validates optional review content and rating fields.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - src/modules/comments/controllers/comments.controller.ts
 *   - src/modules/comments/services/comments.service.ts
 */

import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class UpdateCommentDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
