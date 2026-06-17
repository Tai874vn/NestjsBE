import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CandidateDirectoryQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  skill?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;
}
