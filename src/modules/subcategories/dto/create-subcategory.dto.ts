import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export class CreateSubcategoryDto {
  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  image?: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  categoryId: number;
}
