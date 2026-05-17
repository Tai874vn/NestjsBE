import { IsNotEmpty, IsInt } from 'class-validator';

export class CreateHireDto {
  @IsNotEmpty()
  @IsInt()
  jobId: number;
}
