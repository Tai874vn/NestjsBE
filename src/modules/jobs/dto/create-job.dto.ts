/**
 * Request body DTOs and work mode constants for creating a job post in the jobs module. Validates title, price, descriptions, subcategory, work mode, service area, and optional milestone template items.
 *
 * Calls: trimString; optionalTrimString
 * Used by:
 *   - src/modules/jobs/controllers/jobs.controller.ts
 *   - src/modules/jobs/dto/update-job.dto.ts
 *   - src/modules/jobs/services/job-mutation.service.ts
 *   - src/modules/jobs/services/jobs.service.ts
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  ValidateIf,
  ValidateNested,
  IsString,
  IsInt,
  IsOptional,
  MaxLength,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export const WORK_MODES = ['REMOTE', 'ONSITE', 'BOTH'] as const;
export type WorkModeValue = (typeof WORK_MODES)[number];

/** One step of the payment plan a service offers; shares add up to 100. */
export class MilestoneTemplateItemDto {
  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MaxLength(80)
  title: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** Percent of the price for this step (whole number 1 to 100). */
  @IsInt()
  @Min(1)
  @Max(100)
  share: number;
}

export class CreateJobDto {
  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  /** Optional: a portfolio post has no price (0). */
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsNotEmpty()
  @IsInt()
  subcategoryId: number;

  @IsOptional()
  @IsIn(WORK_MODES)
  workMode?: WorkModeValue;

  /** Kept only when the work mode is not REMOTE (the service clears it). */
  @Transform(optionalTrimString)
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceArea?: string | null;

  /** null clears the template. The "adds up to 100" check is in the service. */
  @ValidateIf((_o, v) => v !== null)
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MilestoneTemplateItemDto)
  milestoneTemplate?: MilestoneTemplateItemDto[] | null;
}
