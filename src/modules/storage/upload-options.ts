import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { imageFileFilter } from '../../common/image-file-filter';
import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES } from './storage-paths';

const allowedDocumentMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export function documentFileFilter(
  _request: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!allowedDocumentMimeTypes.has(file.mimetype)) {
    callback(
      new BadRequestException('Only PDF and DOCX files are allowed'),
      false,
    );
    return;
  }

  callback(null, true);
}

/** Shared Multer options for single-image uploads (5 MB max, 1 file, small text fields). */
export const imageUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: IMAGE_MAX_BYTES,
    files: 1,
    fields: 10,
    fieldNameSize: 100,
    fieldSize: 32 * 1024,
    parts: 11,
  },
  fileFilter: imageFileFilter,
};

/** Shared Multer options for CV/resume document uploads (10 MB max, 1 file, small text fields). */
export const documentUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: DOCUMENT_MAX_BYTES,
    files: 1,
    fields: 5,
    fieldNameSize: 100,
    fieldSize: 16 * 1024,
    parts: 6,
  },
  fileFilter: documentFileFilter,
};
