import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { commaList } from '../../../common/dto/string.transforms';

export const jobSearchSortOptions = [
  'newest',
  'price_asc',
  'price_desc',
  'rating_desc',
] as const;

export type JobSearchSort = (typeof jobSearchSortOptions)[number];

// @find jobs search search-in validation [all] — the fields a keyword MAY be searched in (allowlist)
/** The fields the frontend may ask the keyword to be searched in (?searchIn=title,sellerName). Default: all. */
export const JOB_SEARCH_FIELDS = [
  'title',
  'shortDescription',
  'description',
  'sellerName',
  'subcategory',
  'category',
] as const;
export type JobSearchField = (typeof JOB_SEARCH_FIELDS)[number];

export class JobSearchQueryDto extends PaginationDto {
  @Transform(commaList)
  @IsOptional()
  @IsArray()
  @IsIn(JOB_SEARCH_FIELDS, {
    each: true,
    message: `searchIn must be some of: ${JOB_SEARCH_FIELDS.join(', ')}`,
  })
  searchIn?: JobSearchField[];

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
