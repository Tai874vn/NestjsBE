import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateJobDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(160)
  title: string;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsNotEmpty()
  @IsInt()
  subcategoryId: number;
}
