/**
 * Request body DTO for posting a contract review in the comments module.
 * It validates the contract ID, review content, and 1-to-5 rating.
 *
 * Calls: trimString
 * Used by:
 *   - src/modules/comments/controllers/comments.controller.ts
 *   - src/modules/comments/services/comments.service.ts
 */

import {
  IsNotEmpty,
  IsString,
  IsInt,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from '../../../common/dto/string.transforms';

export class CreateCommentDto {
  /** The contract being reviewed; the service (job) is taken from it. */
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  contractId: number;

  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  content: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
}
