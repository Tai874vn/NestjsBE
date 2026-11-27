/**
 * Request body DTO for hiring-pipeline actions that accept an optional note, such as reject, offer, decline, reschedule, and cancel.
 * Trims the note text and limits it to 1000 characters.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - src/modules/hiring-pipeline/controllers/applications.controller.ts
 *   - src/modules/hiring-pipeline/controllers/interviews.controller.ts
 */

import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { optionalTrimString } from '../../../common/dto/string.transforms';

/** Body of reject, offer and decline: an optional note (up to 1000 characters) for the other side. */
export class ApplicationActionDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
