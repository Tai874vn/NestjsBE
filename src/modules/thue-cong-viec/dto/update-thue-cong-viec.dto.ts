import { PartialType } from '@nestjs/mapped-types';
import { CreateThueCongViecDto } from './create-thue-cong-viec.dto';

export class UpdateThueCongViecDto extends PartialType(CreateThueCongViecDto) {}
