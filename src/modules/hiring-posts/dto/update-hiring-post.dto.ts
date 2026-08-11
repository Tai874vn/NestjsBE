import { PartialType } from '@nestjs/mapped-types';
import { HiringPostStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateHiringPostDto } from './create-hiring-post.dto';

export class UpdateHiringPostDto extends PartialType(CreateHiringPostDto) {
  @IsOptional()
  @IsEnum(HiringPostStatus)
  status?: HiringPostStatus;
}
