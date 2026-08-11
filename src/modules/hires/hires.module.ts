import { Module } from '@nestjs/common';
import { HiresService } from './services/hires.service';
import { HiresController } from './controllers/hires.controller';
import { PrismaService } from '../../prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [HiresController],
  providers: [HiresService, PrismaService],
  exports: [HiresService],
})
export class HiresModule {}
