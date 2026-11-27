/**
 * NestJS module for the connections feature.
 * It imports NotificationsModule, registers ConnectionsController, and registers and exports ConnectionsService.
 *
 * Calls: NotificationsModule; ConnectionsController; ConnectionsService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConnectionsController } from './controllers/connections.controller';
import { ConnectionsService } from './services/connections.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
