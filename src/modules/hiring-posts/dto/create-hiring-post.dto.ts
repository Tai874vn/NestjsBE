import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsISO4217CurrencyCode,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export const SALARY_PERIODS = ['month', 'year', 'hour'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export class CreateHiringPostDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  @MaxLength(5000)
  description: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  requirements?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  employmentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number;

  /** ISO 4217 code of salaryMin/salaryMax, e.g. USD or VND. Defaults to USD. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || undefined : value,
  )
  @IsOptional()
  @IsISO4217CurrencyCode({
    message: 'salaryCurrency must be an ISO 4217 currency code, e.g. USD',
  })
  salaryCurrency?: string;

  /** What salaryMin/salaryMax are paid per. Defaults to month. */
  @Transform(optionalTrimString)
  @IsOptional()
  @IsIn(SALARY_PERIODS, {
    message: `salaryPeriod must be one of ${SALARY_PERIODS.join(', ')}`,
  })
  salaryPeriod?: SalaryPeriod;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  /** ESCO occupation code from GET /api/occupations; the AI reads the level from this and the required years. */
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  occupationCode: string;

  /** One of the occupation's specialties, optional. */
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  specialty?: string;

  @IsInt()
  @Min(0)
  @Max(40)
  yearsRequired: number;

  /** Skill names picked from the dictionary. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? [
          ...new Map(
            value
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item) => [item.toLowerCase(), item] as const),
          ).values(),
        ]
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  skills?: string[];

  /**
   * How many people the post hires, 1 to 50. Not sent: 1.
   * null means "keep hiring until I close the post" (no limit).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  openings?: number | null;

  /** When the post stops being listed. */
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
