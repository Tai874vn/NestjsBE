import { Module } from '@nestjs/common';
import { ChiTietLoaiCongViecService } from './services/chi-tiet-loai-cong-viec.service';
import { ChiTietLoaiCongViecController } from './controllers/chi-tiet-loai-cong-viec.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [ChiTietLoaiCongViecController],
  providers: [ChiTietLoaiCongViecService, PrismaService],
  exports: [ChiTietLoaiCongViecService],
})
export class ChiTietLoaiCongViecModule {}
