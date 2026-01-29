import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateThueCongViecDto {
  @IsOptional()
  @IsBoolean()
  hoanThanh?: boolean;
}
