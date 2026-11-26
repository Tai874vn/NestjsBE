import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { optionalTrimString } from './string.transforms';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @IsOptional()
  @Transform(optionalTrimString)
  @IsString()
  @MaxLength(80)
  // @find shared search keyword validation [all] — every keyword box: trimmed, text, max 80 characters
  keyword?: string;
}
