import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export class CreateJobDto {
  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  /** Optional: a portfolio post has no price (0). */
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsNotEmpty()
  @IsInt()
  subcategoryId: number;
}
