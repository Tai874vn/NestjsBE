/**
 * Common Multer file filter that restricts image uploads to JPEG, PNG, and WebP MIME types.
 * Rejects other file types with a 400 Bad Request error.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/storage/utils/upload-options.ts
 */

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
