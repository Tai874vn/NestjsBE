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
