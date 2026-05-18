import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @MaxLength(30)
  birthDay?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  website?: string;
}

export class ProfileSkillDto {
  @IsString()
  @MaxLength(80)
  name: string;

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

export class ProfileCertificationDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  issuer?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  credentialUrl?: string;

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
  @IsString()
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  image?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(300)
  url?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
