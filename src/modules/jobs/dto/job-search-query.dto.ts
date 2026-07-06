import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export const jobSearchSortOptions = [
  'newest',
  'price_asc',
  'price_desc',
  'rating_desc',
] as const;

export type JobSearchSort = (typeof jobSearchSortOptions)[number];

export class JobSearchQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subcategoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @IsIn(jobSearchSortOptions)
  sort?: JobSearchSort;
}
