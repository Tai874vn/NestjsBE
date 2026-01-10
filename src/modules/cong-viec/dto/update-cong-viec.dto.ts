import { PartialType } from '@nestjs/mapped-types';
import { CreateCongViecDto } from './create-cong-viec.dto';

export class UpdateCongViecDto extends PartialType(CreateCongViecDto) {}
