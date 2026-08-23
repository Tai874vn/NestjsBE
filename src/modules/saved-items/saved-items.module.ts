import { Module } from '@nestjs/common';
import { SavedItemsController } from './controllers/saved-items.controller';
import { SavedItemsService } from './services/saved-items.service';

@Module({
  controllers: [SavedItemsController],
  providers: [SavedItemsService],
  exports: [SavedItemsService],
})
export class SavedItemsModule {}
