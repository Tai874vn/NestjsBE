import { IsNotEmpty, IsString, IsInt, Min, Max } from 'class-validator';

export class CreateCommentDto {
  @IsNotEmpty()
  @IsInt()
  jobId: number;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
}
