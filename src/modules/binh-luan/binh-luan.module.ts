import { Module } from '@nestjs/common';
import { BinhLuanService } from './services/binh-luan.service';
import { BinhLuanController } from './controllers/binh-luan.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [BinhLuanController],
  providers: [BinhLuanService, PrismaService],
  exports: [BinhLuanService],
})
export class BinhLuanModule {}
