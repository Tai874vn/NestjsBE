import { IsNotEmpty, IsString } from 'class-validator';

export class CreateLoaiCongViecDto {
  @IsNotEmpty()
  @IsString()
  tenLoaiCongViec: string;
}
