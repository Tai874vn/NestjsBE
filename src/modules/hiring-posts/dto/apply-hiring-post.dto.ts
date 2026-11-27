/**
 * Request body DTO for applying to a hiring post in the hiring-posts module. Validates the optional cover letter text.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - src/modules/hiring-posts/controllers/hiring-posts.controller.ts
 *   - src/modules/hiring-posts/services/hiring-posts.service.ts
 */

import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class ApplyHiringPostDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  coverLetter?: string;
}
