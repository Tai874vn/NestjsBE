import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export class UpdateMyProfileDto {
  @IsOptional()
  @IsBoolean()
  candidateDiscoverable?: boolean;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @MaxLength(30)
  birthDay?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  website?: string;
}

export class ProfileSkillDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  level?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ReplaceProfileSkillsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProfileSkillDto)
  skills: ProfileSkillDto[];
}

export const CERTIFICATION_CATEGORIES = [
  'Certification',
  'License',
  'Course',
  'Badge',
] as const;

/**
 * One credential, in the shape LinkedIn, Open Badges, and schema.org share: name, issuing organization, issue and
 * expiry dates, credential ID and URL to verify it, its kind, and the skills it shows.
 */
export class ProfileCertificationDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1, { message: 'Add the issuing organization' })
  @MaxLength(120)
  issuer: string;

  @IsOptional()
  @IsIn(CERTIFICATION_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  skills?: string[];

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  credentialUrl?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  credentialId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ReplaceProfileCertificationsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProfileCertificationDto)
  certifications: ProfileCertificationDto[];
}

export class UpsertPortfolioItemDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  image?: string;

  @Transform(optionalTrimString)
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  url?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
