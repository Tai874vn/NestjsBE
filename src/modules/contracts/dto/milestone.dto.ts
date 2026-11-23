import { ContractStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../../../common/dto/string.transforms';
import { IsOurImage, IsWebLink } from './proposal.dto';

export const CONTRACT_MAX_PAGE_SIZE = 50;

function emptyListIfNull({ value }: { value: unknown }): unknown {
  return value ?? [];
}

/** Body of POST /milestones/:id/submit: a note plus up to 10 images and 10 links. */
export class SubmitWorkDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;

  // null (or no value) means an empty list, so Prisma never gets null for a list column.
  @Transform(emptyListIfNull)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsOurImage({
    each: true,
    message: 'images must be uploaded through JobAura.',
  })
  images: string[] = [];

  @Transform(emptyListIfNull)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsWebLink({ each: true, message: 'links must be web links.' })
  links: string[] = [];
}

/** Body of POST /milestones/:id/request-changes: what to change (1 to 2000 characters). */
export class RequestChangesDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note: string;
}

/** GET /contracts?role=client|freelancer&status=&page&pageSize — pageSize is at most 50. */
export class ContractListQueryDto {
  @IsOptional()
  @IsIn(['client', 'freelancer'])
  role: 'client' | 'freelancer' = 'client';

  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONTRACT_MAX_PAGE_SIZE)
  pageSize: number = 20;
}
