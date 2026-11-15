import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { CAREER_FIELDS } from '../../../common/career-fields';
import { Transform } from 'class-transformer';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

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

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  /** One of the 37 career fields; the AI reads the level from this and the required years. */
  @IsIn(CAREER_FIELDS)
  careerField: string;

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

  /** When the post stops being listed. */
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
