import { PartialType } from '@nestjs/mapped-types';
import { CreateChiTietLoaiCongViecDto } from './create-chi-tiet-loai-cong-viec.dto';

export class UpdateChiTietLoaiCongViecDto extends PartialType(CreateChiTietLoaiCongViecDto) {}
