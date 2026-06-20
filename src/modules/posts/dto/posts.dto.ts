import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class FeedQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 10;
}

export class CommentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 10;
}

export class CreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  content?: string;
}

export class CreatePostCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content: string;
}

export class UpdatePostCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content: string;
}
