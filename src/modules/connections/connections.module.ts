import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ConnectionsController } from './controllers/connections.controller';
import { ConnectionsService } from './services/connections.service';

@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService, PrismaService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
