import { IsNotEmpty, IsString, IsInt, IsOptional, Min } from 'class-validator';

export class CreateCongViecDto {
  @IsNotEmpty()
  @IsString()
  tenCongViec: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  danhGia?: number;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  giaTien: number;

  @IsOptional()
  @IsString()
  hinhAnh?: string;

  @IsOptional()
  @IsString()
  moTa?: string;

  @IsOptional()
  @IsString()
  moTaNgan?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  saoCongViec?: number;

  @IsNotEmpty()
  @IsInt()
  maChiTietLoai: number;

  @IsOptional()
  @IsInt()
  nguoiTao?: number;
}
