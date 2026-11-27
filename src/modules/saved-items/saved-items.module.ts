/**
 * NestJS module for the saved-items feature. Registers SavedItemsController and SavedItemsService, and exports SavedItemsService.
 *
 * Calls: SavedItemsController; SavedItemsService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { SavedItemsController } from './controllers/saved-items.controller';
import { SavedItemsService } from './services/saved-items.service';

@Module({
  controllers: [SavedItemsController],
  providers: [SavedItemsService],
  exports: [SavedItemsService],
})
export class SavedItemsModule {}
