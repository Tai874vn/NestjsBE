import { Module } from '@nestjs/common';
import { LoaiCongViecService } from './services/loai-cong-viec.service';
import { LoaiCongViecController } from './controllers/loai-cong-viec.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [LoaiCongViecController],
  providers: [LoaiCongViecService, PrismaService],
  exports: [LoaiCongViecService],
})
export class LoaiCongViecModule {}
