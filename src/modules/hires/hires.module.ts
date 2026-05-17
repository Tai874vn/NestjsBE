import { Module } from '@nestjs/common';
import { HiresService } from './services/hires.service';
import { HiresController } from './controllers/hires.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [HiresController],
  providers: [HiresService, PrismaService],
  exports: [HiresService],
})
export class HiresModule {}
