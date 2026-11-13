import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export class SearchSkillsDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q: string;

  /** A JobAura career field; matching skills from that field are listed first. */
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  field?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ExtractSkillsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  text: string;
}
