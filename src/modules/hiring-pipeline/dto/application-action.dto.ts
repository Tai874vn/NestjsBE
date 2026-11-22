import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { optionalTrimString } from '../../../common/dto/string.transforms';

/** Body of reject, offer and decline: an optional note (up to 1000 characters) for the other side. */
export class ApplicationActionDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
