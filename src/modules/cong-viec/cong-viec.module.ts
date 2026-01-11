import { Module } from '@nestjs/common';
import { CongViecService } from './services/cong-viec.service';
import { CongViecController } from './controllers/cong-viec.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [CongViecController],
  providers: [CongViecService, PrismaService],
  exports: [CongViecService],
})
export class CongViecModule {}
