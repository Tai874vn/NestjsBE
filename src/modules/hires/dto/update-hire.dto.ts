import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateHireDto {
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
