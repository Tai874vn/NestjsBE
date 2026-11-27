/**
 * Request DTO for the users module. Validates optional user account and profile fields when updating a user.
 *
 * Calls: optionalNormalizeEmail; optionalTrimString
 * Used by:
 *   - src/modules/users/controllers/users.controller.ts
 *   - src/modules/users/services/users.service.ts
 */

import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  optionalNormalizeEmail,
  optionalTrimString,
} from '../../../common/dto/string.transforms';

export class UpdateUserDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @Transform(optionalNormalizeEmail)
  @IsOptional()
  @IsEmail()
  email?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @MaxLength(30)
  birthDay?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  skill?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  certification?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;
}
