/**
 * Validation DTOs in the auth module for changing a user's password (ChangePasswordDto) and banning or unbanning a user (BanUserDto).
 *
 * Calls: PASSWORD_MIN_LENGTH
 * Used by:
 *   - src/modules/auth/controllers/auth-sessions.controller.ts
 */

import { IsBoolean, IsByteLength, IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../../common/constants/password';

export class ChangePasswordDto {
  @IsString()
  @IsByteLength(1, 72)
  currentPassword: string;

  // Uses the same shared minimum password length as sign-up and reset-password.
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @IsByteLength(PASSWORD_MIN_LENGTH, 72)
  newPassword: string;
}

export class BanUserDto {
  @IsBoolean()
  banned: boolean;
}
