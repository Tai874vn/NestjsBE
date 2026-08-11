import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

const allowedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function imageFileFilter(
  _request: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!allowedImageMimeTypes.has(file.mimetype)) {
    callback(new BadRequestException('Only image files are allowed'), false);
    return;
  }

  callback(null, true);
}
