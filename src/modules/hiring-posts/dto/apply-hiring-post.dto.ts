import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class ApplyHiringPostDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  coverLetter?: string;
}
