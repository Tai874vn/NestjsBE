import { Module } from '@nestjs/common';
import { HiresService } from './services/hires.service';
import { HiresController } from './controllers/hires.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [HiresController],
  providers: [HiresService],
  exports: [HiresService],
})
export class HiresModule {}
