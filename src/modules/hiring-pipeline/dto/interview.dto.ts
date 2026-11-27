/**
 * Request body DTOs for requesting interviews, sending new time slots, and accepting a time in the hiring-pipeline module.
 * Validates interview mode, duration, onsite location, optional note, and ISO 8601 dates.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - src/modules/hiring-pipeline/controllers/interviews.controller.ts
 */

import { InterviewMode } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { optionalTrimString } from '../../../common/dto/string.transforms';

/**
 * Body of "new times": 1 to 3 start times as ISO 8601 text (for example "2026-11-25T10:00:00+07:00").
 * The service also checks that each is in the future and that they are all different.
 */
export class InterviewTimesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsISO8601({ strict: true }, { each: true })
  proposedTimes: string[];
}

/** Body of an interview request: how, when (1 to 3 times), how long, where, and a note. */
export class RequestInterviewDto extends InterviewTimesDto {
  @IsEnum(InterviewMode)
  mode: InterviewMode;

  /** Minutes, 15 to 120; 45 when not given. */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(120)
  durationMinutes?: number;

  /** Address, meeting link or phone number; needed for ONSITE. */
  @Transform(optionalTrimString)
  @ValidateIf(
    (dto: RequestInterviewDto) =>
      dto.mode === InterviewMode.ONSITE || dto.location !== undefined,
  )
  @IsString()
  @IsNotEmpty({ message: 'location is needed for an onsite interview.' })
  @MaxLength(300)
  location?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Body of "accept": the chosen start time, one of the offered times. */
export class AcceptInterviewDto {
  @IsISO8601({ strict: true })
  startsAt: string;
}
