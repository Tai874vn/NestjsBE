/**
 * Posts module DTOs that validate feed and comment pagination queries and payloads for creating posts, creating comments, and updating comments.
 *
 * Calls: optionalTrimString; trimString
 * Used by:
 *   - src/modules/posts/controllers/posts.controller.ts
 *   - src/modules/posts/services/posts.service.ts
 */

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
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  content?: string;
}

export class CreatePostCommentDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content: string;
}

export class UpdatePostCommentDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content: string;
}
