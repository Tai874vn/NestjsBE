/**
 * Request DTO and file metadata types for resume imports in the users module. Validates parsed CV JSON data along with optional source file name and schema version.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/users/controllers/users.controller.ts
 *   - src/modules/users/services/user-resume.service.ts
 */

import {
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export type ParsedResumeData = Record<string, unknown>;

export class ImportResumeDto {
  @IsObject()
  @IsNotEmptyObject({ nullable: false })
  data: ParsedResumeData;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceFileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  schemaVersion?: string;
}

export interface UploadedResumeFileMetadata {
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  publicId: string;
}
