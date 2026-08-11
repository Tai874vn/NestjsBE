import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class CandidateDirectoryQueryDto extends PaginationDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  skill?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasPortfolio?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasCertification?: boolean;
}
