import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
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
  /** Same rule as sign-up. */
  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;
}
