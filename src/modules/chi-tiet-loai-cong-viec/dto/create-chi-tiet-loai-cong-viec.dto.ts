import { IsNotEmpty, IsString, IsInt, IsOptional } from 'class-validator';

export class CreateChiTietLoaiCongViecDto {
  @IsNotEmpty()
  @IsString()
  tenChiTiet: string;

  @IsOptional()
  @IsString()
  hinhAnh?: string;

  @IsNotEmpty()
  @IsInt()
  maLoaiCongViec: number;
}
