import {
  IsNotEmpty,
  IsString,
  IsInt,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from '../../../common/dto/string.transforms';

export class CreateCommentDto {
  @IsNotEmpty()
  @IsInt()
  jobId: number;

  @Transform(trimString)
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  content: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
}
