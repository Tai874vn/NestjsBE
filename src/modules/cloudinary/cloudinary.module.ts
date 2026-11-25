import { Module, Global } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';

/**
 * @deprecated Replaced by StorageModule. Kept only until `npm run migrate:files` has run.
 */
@Global()
@Module({
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class CloudinaryModule {}
