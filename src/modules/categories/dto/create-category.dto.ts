import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../../common/dto/string.transforms';

export class CreateCategoryDto {
  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;
}
