import { ProposalStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';
import { isLocalImageUrl } from '../../storage/storage-paths';

export const MAX_REFERENCES = 10;
export const PROPOSAL_MAX_PAGE_SIZE = 50;
/**
 * The most credits one milestone may carry. A bigger number is a 400 naming the field (and
 * never overflows the contract total, a 32-bit whole number in the database).
 */
export const MAX_MILESTONE_CREDITS = 1_000_000;

function emptyListIfNull({ value }: { value: unknown }): unknown {
  return value ?? [];
}

/** A link people can open in a browser: only http: or https: (so never `javascript:`). */
export function isWebLink(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * An image uploaded through JobAura: it lives in our local storage under
 * `/uploads/images/<folder>/<uuid>.webp`. Any other path, extension, traversal or external host
 * is rejected.
 */
export function isOurImage(value: unknown): boolean {
  return isLocalImageUrl(value);
}

/** Each item is a web link (see isWebLink). Used by proposals and, later, submissions. */
export function IsWebLink(options?: ValidationOptions) {
  return ValidateBy(
    { name: 'isWebLink', validator: { validate: isWebLink } },
    options,
  );
}

/** Each item is an image uploaded through JobAura (see isOurImage). */
export function IsOurImage(options?: ValidationOptions) {
  return ValidateBy(
    { name: 'isOurImage', validator: { validate: isOurImage } },
    options,
  );
}

/** One milestone row of a version. dueDate is ISO 8601 text (the app sends 23:59 local time). */
export class MilestoneInputDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsISO8601({ strict: true })
  dueDate: string;

  /** Whole credits, 1 to 1,000,000. */
  @IsInt()
  @Min(1)
  @Max(MAX_MILESTONE_CREDITS)
  amount: number;
}

/**
 * One version of a proposal: the brief, references, deadline and 1 to 20 milestones.
 * The service also checks the dates (first due date in the future, in order, not after the deadline).
 */
export class VersionBodyDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  brief: string;

  // null (or no value) means an empty list, so Prisma never gets null for a list column.
  @Transform(emptyListIfNull)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REFERENCES)
  @IsWebLink({ each: true, message: 'referenceLinks must be web links.' })
  referenceLinks: string[] = [];

  // null (or no value) means an empty list, so Prisma never gets null for a list column.
  @Transform(emptyListIfNull)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_REFERENCES)
  @IsOurImage({
    each: true,
    message: 'referenceImages must be uploaded through JobAura.',
  })
  referenceImages: string[] = [];

  @IsISO8601({ strict: true })
  deadline: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MilestoneInputDto)
  milestones: MilestoneInputDto[];
}

/** Body of POST /proposals: the first version plus the service (job) it is for. */
export class CreateProposalDto extends VersionBodyDto {
  @IsInt()
  @Min(1)
  jobId: number;
}

/** Body of accept: the version number the user read. A newer one gives 409. */
export class AcceptProposalDto {
  @IsInt()
  @Min(1)
  version: number;
}

/** Body of decline: an optional note (up to 1000 characters). */
export class DeclineProposalDto {
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** GET /proposals?role=client|freelancer&status=&page&pageSize — pageSize is at most 50. */
export class ProposalListQueryDto {
  @IsOptional()
  @IsIn(['client', 'freelancer'])
  role: 'client' | 'freelancer' = 'client';

  @IsOptional()
  @IsEnum(ProposalStatus)
  status?: ProposalStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PROPOSAL_MAX_PAGE_SIZE)
  pageSize: number = 20;
}
