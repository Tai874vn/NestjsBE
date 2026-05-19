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
