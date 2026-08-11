import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConnectionsController } from './controllers/connections.controller';
import { ConnectionsService } from './services/connections.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, PrismaService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
