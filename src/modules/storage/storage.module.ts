/**
 * Global NestJS module for the storage feature. Registers FilesController and StorageService, and exports StorageService.
 *
 * Calls: FilesController; StorageService
 * Used by:
 *   - src/app.module.ts
 */

import { Global, Module } from '@nestjs/common';
import { FilesController } from './controllers/files.controller';
import { StorageService } from './services/storage.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
