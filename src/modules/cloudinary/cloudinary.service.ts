import {
  Injectable,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

/** Cloudinary status codes that mean the uploaded file itself is bad, not our account or server. */
const USER_FILE_UPLOAD_ERROR_CODES = new Set([400, 413, 415, 422]);

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<UploadApiResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
      throw new BadRequestException('Only image files are allowed');
    }
    this.validateImageSignature(file);

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: 'image',
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result) => {
          if (error) {
            reject(this.mapUploadError(error));
          } else if (result) {
            resolve(result);
          } else {
            reject(this.mapUploadError(undefined));
          }
        },
      );

      const readableStream = new Readable();
      readableStream.push(file.buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  }

  async uploadDocument(
    file: Express.Multer.File,
    folder: string,
  ): Promise<UploadApiResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const allowedMimeTypes = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException(
        'Only PDF, DOC, and DOCX files are allowed',
      );
    }
    this.validateDocumentSignature(file);

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'raw',
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error) {
            reject(this.mapUploadError(error));
          } else if (result) {
            resolve(result);
          } else {
            reject(this.mapUploadError(undefined));
          }
        },
      );

      const readableStream = new Readable();
      readableStream.push(file.buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    await this.deleteResource(publicId, 'image');
  }

  async deleteDocument(publicId: string): Promise<void> {
    await this.deleteResource(publicId, 'raw');
  }

  extractPublicId(url: string): string | null {
    if (!url || !url.includes('cloudinary')) {
      return null;
    }
    const matches = url.match(/\/v\d+\/(.+)\.\w+$/);
    return matches ? matches[1] : null;
  }

  private mapUploadError(error?: { message?: string; http_code?: number }) {
    // Only user-file rejection codes from Cloudinary stay a 400.
    // Auth, config, rate-limit (401, 403, 404, 420, 429), 5xx, and network errors
    // are upstream/server failures and become 503 with the original cause attached.
    if (
      typeof error?.http_code === 'number' &&
      USER_FILE_UPLOAD_ERROR_CODES.has(error.http_code)
    ) {
      return new BadRequestException(
        'Upload failed. Please check the file and try again.',
      );
    }
    return new ServiceUnavailableException(
      'File upload service is unavailable. Please try again.',
      { cause: error },
    );
  }

  private async deleteResource(
    publicId: string,
    resourceType: 'image' | 'raw',
  ): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to delete ${resourceType} from Cloudinary: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private validateImageSignature(file: Express.Multer.File) {
    const buffer = file.buffer;
    if (!buffer || buffer.length < 12) {
      throw new BadRequestException('Invalid image file');
    }

    const isJpeg =
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    const header = buffer.subarray(0, 6).toString('ascii');
    const isGif = header === 'GIF87a' || header === 'GIF89a';
    const isWebp =
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!(isJpeg || isPng || isGif || isWebp)) {
      throw new BadRequestException('Invalid image file');
    }
  }

  private validateDocumentSignature(file: Express.Multer.File) {
    const buffer = file.buffer;
    if (!buffer || buffer.length < 4) {
      throw new BadRequestException('Invalid document file');
    }

    const isPdf = buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isDoc =
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0;
    const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4b;

    if (!(isPdf || isDoc || isDocx)) {
      throw new BadRequestException('Invalid document file');
    }
  }
}
