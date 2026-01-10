import { IsNotEmpty, IsString, IsInt, Min, Max } from 'class-validator';

export class CreateBinhLuanDto {
  @IsNotEmpty()
  @IsInt()
  maCongViec: number;

  @IsNotEmpty()
  @IsInt()
  maNguoiBinhLuan: number;

  @IsNotEmpty()
  @IsString()
  noiDung: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  saoBinhLuan: number;
}
