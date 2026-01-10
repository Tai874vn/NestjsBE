import { Module } from '@nestjs/common';
import { ThueCongViecService } from './services/thue-cong-viec.service';
import { ThueCongViecController } from './controllers/thue-cong-viec.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [ThueCongViecController],
  providers: [ThueCongViecService, PrismaService],
  exports: [ThueCongViecService],
})
export class ThueCongViecModule {}
