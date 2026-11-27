/**
 * Validation DTO in the auth module for email and password sign-in requests.
 *
 * Calls: normalizeEmail
 * Used by:
 *   - src/modules/auth/controllers/auth.controller.ts
 *   - src/modules/auth/services/auth.service.ts
 */

import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '../../../common/dto/string.transforms';

export class SignInDto {
  @Transform(normalizeEmail)
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  password: string;
}
