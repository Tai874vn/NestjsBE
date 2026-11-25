import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

const allowedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function imageFileFilter(
  _request: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!allowedImageMimeTypes.has(file.mimetype)) {
    callback(
      new BadRequestException(
        'This image could not be read. Use a JPG, PNG or WebP file.',
      ),
      false,
    );
    return;
  }

  callback(null, true);
}
