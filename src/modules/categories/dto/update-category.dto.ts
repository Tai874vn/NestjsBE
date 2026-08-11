import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class UpdateCategoryDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
