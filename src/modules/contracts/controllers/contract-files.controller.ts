/**
 * HTTP controller for uploading proposal and submission images in the contracts module.
 * Routes: POST /api/contracts/attachments -> upload().
 *
 * Calls: StorageService; imageUploadOptions; JwtAuthGuard
 * Used by:
 *   - src/modules/contracts/contracts.module.ts
 */

import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { StorageService } from '../../storage/services/storage.service';
import { imageUploadOptions } from '../../storage/utils/upload-options';

/**
 * Image upload for proposals and submissions (any role). The answer is our local relative URL,
 * which the client then puts in referenceImages (or a submission's images). Only local URLs
 * uploaded through JobAura are accepted there.
 */
@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractFilesController {
  constructor(private readonly storage: StorageService) {}

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required.');
    }
    const result = await this.storage.uploadImage(file, 'contracts');
    return { message: 'File uploaded', content: { url: result.url } };
  }
}
