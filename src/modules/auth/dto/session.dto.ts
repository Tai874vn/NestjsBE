import { IsBoolean, IsByteLength, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsByteLength(1, 72)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @IsByteLength(8, 72)
  newPassword: string;
}

export class BanUserDto {
  @IsBoolean()
  banned: boolean;
}
