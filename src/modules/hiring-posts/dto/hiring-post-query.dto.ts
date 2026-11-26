import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidationArguments,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export const HIRING_POST_LEVELS = ['Junior', 'Mid', 'Senior'] as const;
export type HiringPostLevel = (typeof HIRING_POST_LEVELS)[number];

export const HIRING_POST_SORTS = [
  'newest',
  'closing_soon',
  'salary_high',
] as const;
export type HiringPostSort = (typeof HIRING_POST_SORTS)[number];

/** At most this many values in one multi-value filter (level, employmentType, occupation). */
export const MAX_FILTER_VALUES = 10;

/**
 * A multi-value filter: `?level=Junior,Mid`, `?level=Junior&level=Mid`, or one plain value as before.
 * Trimmed, empty items dropped, repeats (ignoring case) kept once. Nothing left means no filter.
 */
function filterList({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value : [value];
  if (raw.some((item) => typeof item !== 'string')) return value;
  const items = (raw as string[])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = items.filter(
    (item, index) =>
      items.findIndex((other) => other.toLowerCase() === item.toLowerCase()) ===
      index,
  );
  return unique.length ? unique : undefined;
}

/** Levels are matched ignoring case, then stored in their canonical spelling ("mid" → "Mid"). */
function levelList(params: { value: unknown }): unknown {
  const list = filterList(params);
  if (!Array.isArray(list)) return list;
  return list.map(
    (item: string) =>
      HIRING_POST_LEVELS.find(
        (level) => level.toLowerCase() === item.toLowerCase(),
      ) ?? item,
  );
}

function invalidLevelMessage({ value }: ValidationArguments): string {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  const invalid = values.filter(
    (item) => !(HIRING_POST_LEVELS as readonly unknown[]).includes(item),
  );
  return `level must be one of ${HIRING_POST_LEVELS.join(', ')}; invalid: ${invalid.join(', ')}`;
}

/**
 * The list stops at this page: OFFSET reads and throws away every row before the page, so deep pages get slow,
 * and nobody pages that far; past it the candidate narrows the search instead.
 */
export const MAX_HIRING_POST_PAGE = 100;

/** Filters a candidate uses to narrow open hiring posts. Within a filter values are OR, between filters AND. */
export class HiringPostQueryDto extends PaginationDto {
  // Same as PaginationDto.page (number, at least 1), capped at MAX_HIRING_POST_PAGE.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_HIRING_POST_PAGE, {
    message: `page must not be greater than ${MAX_HIRING_POST_PAGE}; narrow the search to see more posts`,
  })
  page?: number = 1;

  /** ESCO occupation codes; posts for any of them. Unknown codes are rejected by the service (400). */
  @Transform(filterList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `occupation accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  // @find hiring-posts filters all validation [all] — allowed values and sizes of every list filter (400 when wrong)
  occupation?: string[];

  @Transform(levelList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `level accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsIn(HIRING_POST_LEVELS, { each: true, message: invalidLevelMessage })
  level?: HiringPostLevel[];

  @Transform(filterList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES, {
    message: `employmentType accepts at most ${MAX_FILTER_VALUES} values`,
  })
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  employmentType?: string[];

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  // @find hiring-posts filters location validation [all] — location: trimmed, text, max 120 characters
  location?: string;

  /**
   * newest (default): last updated first. closing_soon: nearest closing date first, posts without one last.
   * salary_high: highest salaryMax, then salaryMin, posts without a salary last. Salaries are compared as
   * stored: amounts in other currencies or periods are NOT converted.
   */
  @Transform(optionalTrimString)
  @IsOptional()
  @IsIn(HIRING_POST_SORTS, {
    message: `sort must be one of ${HIRING_POST_SORTS.join(', ')}`,
  })
  sort?: HiringPostSort;
}
