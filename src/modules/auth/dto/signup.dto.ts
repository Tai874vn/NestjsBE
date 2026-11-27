/**
 * Validation DTO in the auth module for new account registration requests, including optional profile fields and account role.
 *
 * Calls: PASSWORD_MIN_LENGTH; Role; normalizeEmail; trimString; optionalTrimString
 * Used by:
 *   - src/modules/auth/controllers/auth.controller.ts
 *   - src/modules/auth/services/auth.service.ts
 */

import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsOptional,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PASSWORD_MIN_LENGTH } from '../../../common/constants/password';
import { Role } from '../../../common/constants/roles';
import {
  normalizeEmail,
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export class SignUpDto {
  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @Transform(normalizeEmail)
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  birthDay?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string;

  @IsOptional()
  @IsIn([Role.USER, Role.EMPLOYER])
  role?: Role.USER | Role.EMPLOYER;

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
