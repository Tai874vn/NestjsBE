import {
  IsNotEmpty,
  IsString,
  IsInt,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export class CreateCommentDto {
  @IsNotEmpty()
  @IsInt()
  jobId: number;

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
