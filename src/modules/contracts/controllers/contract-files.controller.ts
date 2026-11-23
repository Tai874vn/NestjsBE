import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { imageFileFilter } from '../../../common/image-file-filter';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

/**
 * Image upload for proposals and submissions (any role). The answer is the Cloudinary URL, which
 * the client then puts in referenceImages (or a submission's images). Only URLs from our own
 * Cloudinary account are accepted there.
 */
@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractFilesController {
  constructor(private readonly cloudinary: CloudinaryService) {}

  @Post('attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: imageFileFilter,
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required.');
    }
    const result = await this.cloudinary.uploadImage(file, 'contracts');
    return { message: 'File uploaded', content: { url: result.secure_url } };
  }
}
