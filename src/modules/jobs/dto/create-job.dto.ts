import { IsNotEmpty, IsString, IsInt, IsOptional, Min } from 'class-validator';

export class CreateJobDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reviews?: number;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  rating?: number;

  @IsNotEmpty()
  @IsInt()
  subcategoryId: number;
}
