import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JobSearchQueryDto } from './job-search-query.dto';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class JobCursorQueryDto extends JobSearchQueryDto {
  @IsOptional()
  @Transform(optionalTrimString)
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
