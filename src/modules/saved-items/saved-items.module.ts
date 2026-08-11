import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { SavedItemsController } from './controllers/saved-items.controller';
import { SavedItemsService } from './services/saved-items.service';

@Module({
  controllers: [SavedItemsController],
  providers: [SavedItemsService, PrismaService],
  exports: [SavedItemsService],
})
export class SavedItemsModule {}
