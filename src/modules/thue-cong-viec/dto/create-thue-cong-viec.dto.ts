import { IsNotEmpty, IsInt } from 'class-validator';

export class CreateThueCongViecDto {
  @IsNotEmpty()
  @IsInt()
  maCongViec: number;
}
