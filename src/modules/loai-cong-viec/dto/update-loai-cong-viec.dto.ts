import { IsOptional, IsString } from 'class-validator';

export class UpdateLoaiCongViecDto {
  @IsOptional()
  @IsString()
  tenLoaiCongViec?: string;
}
