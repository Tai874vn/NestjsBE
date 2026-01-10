import { IsNotEmpty, IsInt, IsOptional, IsBoolean } from 'class-validator';

export class CreateThueCongViecDto {
  @IsNotEmpty()
  @IsInt()
  maCongViec: number;

  @IsNotEmpty()
  @IsInt()
  maNguoiThue: number;

  @IsOptional()
  @IsBoolean()
  hoanThanh?: boolean;
}
