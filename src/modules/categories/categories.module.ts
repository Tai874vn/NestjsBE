/**
 * NestJS module for the categories feature.
 * It registers CategoriesController and registers and exports CategoriesService.
 *
 * Calls: CategoriesController; CategoriesService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { CategoriesService } from './services/categories.service';
import { CategoriesController } from './controllers/categories.controller';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
