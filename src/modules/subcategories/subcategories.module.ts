/**
 * NestJS module for the subcategories feature. Registers SubcategoriesController and SubcategoriesService, and exports SubcategoriesService.
 *
 * Calls: SubcategoriesController; SubcategoriesService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { SubcategoriesService } from './services/subcategories.service';
import { SubcategoriesController } from './controllers/subcategories.controller';

@Module({
  controllers: [SubcategoriesController],
  providers: [SubcategoriesService],
  exports: [SubcategoriesService],
})
export class SubcategoriesModule {}
