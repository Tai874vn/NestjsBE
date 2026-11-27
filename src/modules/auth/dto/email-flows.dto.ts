/**
 * Validation DTOs in the auth module for email flows: requesting verification or reset links (EmailOnlyDto), submitting a mailed token (EmailTokenDto), and setting a new password (ResetPasswordDto).
 *
 * Calls: PASSWORD_MIN_LENGTH; normalizeEmail
 * Used by:
 *   - src/modules/auth/controllers/auth.controller.ts
 */

import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PASSWORD_MIN_LENGTH } from '../../../common/constants/password';
import { normalizeEmail } from '../../../common/dto/string.transforms';

/** "Send the confirm link again" and "forgot password": only the address. */
export class EmailOnlyDto {
  @Transform(normalizeEmail)
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  email: string;
}

/** The token from a mailed link (the part after `#token=`). */
export class EmailTokenDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  token: string;
}

export class ResetPasswordDto extends EmailTokenDto {
  /** Same shared minimum length as sign-up. */
  @IsNotEmpty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password: string;
}
