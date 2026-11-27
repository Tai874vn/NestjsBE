/**
 * Disk storage service for the storage module. Validates, converts images to WebP, writes, deletes, and safely streams public images and private documents.
 *
 * Calls: ConfigService; sharp; detectImageSignature; validateAndDetectDocument; resolveUploadsDir; resolveSafeStoragePath; extractStorageKey; documentMetaFromKey
 * Used by:
 *   - 13 files, for example src/modules/categories/services/categories.service.ts, src/modules/contracts/controllers/contract-files.controller.ts, src/modules/jobs/controllers/jobs.controller.ts
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { constants, type ReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';
import {
  detectImageSignature,
  UNREADABLE_IMAGE_MESSAGE,
  validateAndDetectDocument,
} from '../utils/file-signatures';
import {
  buildDocumentUrl,
  buildImageUrl,
  DOCUMENT_MAX_BYTES,
  DocumentExtension,
  documentMetaFromKey,
  extractStorageKey,
  IMAGE_MAX_BYTES,
  MAX_IMAGE_INPUT_PIXELS,
  maxSideForImageFolder,
  normalizeFolderName,
  parseAllowedOrigins,
  resolveSafeStoragePath,
  resolveUploadsDir,
  StorageArea,
  toPublicDocumentUrl,
} from '../utils/storage-paths';

export interface StoredFileResult {
  /** Public relative URL for images (`/uploads/images/<folder>/<uuid>.webp`) or storage key for documents (`documents/<folder>/<uuid>.<ext>`). */
  url: string;
  /** Storage key relative to the public/private area (`images/...` or `documents/...`). */
  key: string;
  /** Safe MIME type determined from file contents, never from the client header. */
  mimeType: string;
  /** Stored file size in bytes. */
  size: number;
}

export interface DocumentStreamInfo {
  stream: ReadStream;
  contentType: string;
  extension: DocumentExtension;
  size: number;
}

const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp']);

// Public images must stay readable by Nginx (`0755`/`0644`); private documents are owner-only (`0700`/`0600`).
const DIR_MODE_BY_AREA: Record<StorageArea, number> = {
  public: 0o755,
  private: 0o700,
};
const FILE_MODE_BY_AREA: Record<StorageArea, number> = {
  public: 0o644,
  private: 0o600,
};

function isSameOrInside(basePath: string, candidatePath: string): boolean {
  const rel = relative(basePath, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly uploadsDir: string;
  private readonly allowedOrigins: Set<string>;

  constructor(configService?: ConfigService) {
    this.uploadsDir = resolveUploadsDir({
      uploadsDir:
        configService?.get<string>('UPLOADS_DIR') ?? process.env.UPLOADS_DIR,
      nodeEnv: configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV,
    });
    this.allowedOrigins = parseAllowedOrigins(
      configService?.get<string>('FRONTEND_URL') ?? process.env.FRONTEND_URL,
      configService?.get<string>('DEV_FRONTEND_ORIGINS') ??
        process.env.DEV_FRONTEND_ORIGINS,
    );
  }

  /** Validate, re-encode as WebP, strip metadata, resize and save an uploaded image. */
  async uploadImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<StoredFileResult> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    return this.saveImageBuffer(file.buffer, folder);
  }

  /**
   * Process raw image bytes through magic-byte checks and sharp re-encoding, then write
   * atomically to `public/images/<folder>/<uuid>.webp`. Shared by HTTP uploads and migration.
   */
  async saveImageBuffer(
    buffer: Buffer,
    folder: string,
  ): Promise<StoredFileResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException(UNREADABLE_IMAGE_MESSAGE);
    }
    if (buffer.length > IMAGE_MAX_BYTES) {
      throw new PayloadTooLargeException('Image file must be 5 MB or smaller.');
    }

    const safeFolder = normalizeFolderName(folder);
    if (!detectImageSignature(buffer)) {
      throw new BadRequestException(UNREADABLE_IMAGE_MESSAGE);
    }

    const maxSide = maxSideForImageFolder(safeFolder);
    const webpBuffer = await this.reencodeToWebp(buffer, maxSide);
    const key = `images/${safeFolder}/${randomUUID()}.webp`;
    const targetPath = resolveSafeStoragePath(this.uploadsDir, 'public', key);

    await this.writeFileAtomic('public', targetPath, webpBuffer);

    return {
      url: buildImageUrl(key),
      key,
      mimeType: 'image/webp',
      size: webpBuffer.length,
    };
  }

  /** Validate magic bytes and document safety rules, then save an uploaded CV privately. */
  async uploadDocument(
    file: Express.Multer.File,
    folder: string,
  ): Promise<StoredFileResult> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    return this.saveDocumentBuffer(file.buffer, folder);
  }

  /**
   * Validate raw document bytes and write atomically to `private/documents/<folder>/<uuid>.<ext>`.
   * Shared by HTTP uploads and migration.
   */
  async saveDocumentBuffer(
    buffer: Buffer,
    folder: string,
  ): Promise<StoredFileResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('No file provided');
    }
    if (buffer.length > DOCUMENT_MAX_BYTES) {
      throw new PayloadTooLargeException(
        'Document file must be 10 MB or smaller.',
      );
    }

    const safeFolder = normalizeFolderName(folder);
    const detected = validateAndDetectDocument(buffer);
    const key = `documents/${safeFolder}/${randomUUID()}${detected.extension}`;
    const targetPath = resolveSafeStoragePath(this.uploadsDir, 'private', key);

    await this.writeFileAtomic('private', targetPath, buffer);

    return {
      url: key,
      key,
      mimeType: detected.mimeType,
      size: buffer.length,
    };
  }

  /** Remove a stored public image. Missing files are ignored; other failures only log a warning. */
  async deleteImage(keyOrUrl: string | null | undefined): Promise<void> {
    const key = this.extractKey(keyOrUrl);
    if (!key || !key.startsWith('images/')) return;
    await this.deleteFile('public', key);
  }

  /** Remove a stored private document. Missing files are ignored; other failures only log a warning. */
  async deleteDocument(keyOrUrl: string | null | undefined): Promise<void> {
    const key = this.extractKey(keyOrUrl);
    if (!key || !key.startsWith('documents/')) return;
    await this.deleteFile('private', key);
  }

  /** Extract a local storage key from a relative URL, same-origin URL or raw key. */
  extractKey(urlOrKey: string | null | undefined): string | null {
    return extractStorageKey(urlOrKey, this.allowedOrigins);
  }

  buildImageUrl(key: string): string {
    return buildImageUrl(key);
  }

  buildDocumentUrl(key: string): string {
    return buildDocumentUrl(key);
  }

  toPublicDocumentUrl(stored: string | null | undefined): string | null {
    return toPublicDocumentUrl(stored);
  }

  /** Resolve a safe disk path inside the public or private area. */
  resolveSafePath(area: StorageArea, relativeKey: string): string {
    return resolveSafeStoragePath(this.uploadsDir, area, relativeKey);
  }

  /**
   * Open a readable stream for an existing private document without following symlinks.
   * Missing files, symlinks, or paths escaping `private/` all return the same 404.
   */
  async openDocumentStream(key: string): Promise<DocumentStreamInfo> {
    const meta = documentMetaFromKey(key);
    if (!meta) {
      throw new NotFoundException('File not found');
    }

    const filePath = resolveSafeStoragePath(this.uploadsDir, 'private', key);
    const privateBase = resolve(this.uploadsDir, 'private');

    try {
      const [realPrivateBase, realParentDir] = await Promise.all([
        realpath(privateBase),
        realpath(dirname(filePath)),
      ]);
      if (!isSameOrInside(realPrivateBase, realParentDir)) {
        throw new NotFoundException('File not found');
      }
      // Reject symlinks on platforms (such as Windows) where O_NOFOLLOW is not supported.
      const linkInfo = await lstat(filePath);
      if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) {
        throw new NotFoundException('File not found');
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (this.isNotFoundOrSymlinkError(error)) {
        throw new NotFoundException('File not found');
      }
      throw new ServiceUnavailableException(
        'File storage is unavailable. Please try again.',
        { cause: error },
      );
    }

    const openFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(filePath, openFlags);
    } catch (error) {
      if (this.isNotFoundOrSymlinkError(error)) {
        throw new NotFoundException('File not found');
      }
      throw new ServiceUnavailableException(
        'File storage is unavailable. Please try again.',
        { cause: error },
      );
    }

    let fileStat: { size: number; isFile: () => boolean };
    try {
      fileStat = await handle.stat();
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw new ServiceUnavailableException(
        'File storage is unavailable. Please try again.',
        { cause: error },
      );
    }

    if (!fileStat.isFile()) {
      await handle.close().catch(() => undefined);
      throw new NotFoundException('File not found');
    }

    return {
      stream: handle.createReadStream(),
      contentType: meta.contentType,
      extension: meta.extension,
      size: fileStat.size,
    };
  }

  private async reencodeToWebp(
    buffer: Buffer,
    maxSide: number,
  ): Promise<Buffer> {
    try {
      const metadata = await sharp(buffer, {
        limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      }).metadata();

      if (!metadata.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
        throw new BadRequestException(UNREADABLE_IMAGE_MESSAGE);
      }

      // Auto-rotate from EXIF, resize within maxSide, re-encode to WebP (strips EXIF/GPS and any appended bytes).
      return await sharp(buffer, {
        limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      })
        .rotate()
        .resize({
          width: maxSide,
          height: maxSide,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(UNREADABLE_IMAGE_MESSAGE);
    }
  }

  /**
   * Create and chmod every directory from `<uploadsDir>/<area>` down to `dir`,
   * rejecting any symlink that escapes the area root.
   */
  private async ensureSafeAreaDir(
    area: StorageArea,
    dir: string,
  ): Promise<void> {
    const dirMode = DIR_MODE_BY_AREA[area];
    const areaDir = resolve(this.uploadsDir, area);

    await mkdir(this.uploadsDir, { recursive: true });
    await mkdir(areaDir, { recursive: true });

    const areaLink = await lstat(areaDir);
    if (areaLink.isSymbolicLink() || !areaLink.isDirectory()) {
      throw new BadRequestException('Invalid file path.');
    }
    const realUploads = await realpath(this.uploadsDir);
    const realAreaDir = await realpath(areaDir);
    if (!isSameOrInside(realUploads, realAreaDir)) {
      throw new BadRequestException('Invalid file path.');
    }
    await chmod(areaDir, dirMode);

    const relFromArea = relative(areaDir, dir);
    if (relFromArea.startsWith('..') || isAbsolute(relFromArea)) {
      throw new BadRequestException('Invalid file path.');
    }

    const segments = relFromArea ? relFromArea.split(sep).filter(Boolean) : [];
    let current = areaDir;
    for (const segment of segments) {
      current = join(current, segment);
      await mkdir(current, { recursive: true });
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new BadRequestException('Invalid file path.');
      }
      const realCurrent = await realpath(current);
      if (!isSameOrInside(realAreaDir, realCurrent)) {
        throw new BadRequestException('Invalid file path.');
      }
      await chmod(current, dirMode);
    }
  }

  private async writeFileAtomic(
    area: StorageArea,
    targetPath: string,
    data: Buffer,
  ): Promise<void> {
    const dir = dirname(targetPath);
    const tempPath = join(dir, `.tmp-${randomUUID()}`);
    const fileMode = FILE_MODE_BY_AREA[area];
    try {
      await this.ensureSafeAreaDir(area, dir);
      // Use O_CREAT | O_EXCL (`wx`) so a pre-existing symlink at tempPath can never be overwritten.
      await writeFile(tempPath, data, { flag: 'wx', mode: fileMode });
      // Explicitly chmod so process umask cannot loosen private files or break Nginx reads of public files.
      await chmod(tempPath, fileMode);
      await rename(tempPath, targetPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'File upload service is unavailable. Please try again.',
        { cause: error },
      );
    }
  }

  private async deleteFile(area: StorageArea, key: string): Promise<void> {
    try {
      const fullPath = resolveSafeStoragePath(this.uploadsDir, area, key);
      const baseDir = resolve(this.uploadsDir, area);
      const [realBaseDir, realTargetDir] = await Promise.all([
        realpath(baseDir),
        realpath(dirname(fullPath)),
      ]);
      if (!isSameOrInside(realBaseDir, realTargetDir)) {
        this.logger.warn(
          `Refused to delete file outside storage area (${key}).`,
        );
        return;
      }
      await unlink(fullPath);
    } catch (error) {
      if (this.isNotFoundError(error)) return;
      this.logger.warn(
        `Failed to delete stored file (${key}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    );
  }

  private isNotFoundOrSymlinkError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }
    const code = (error as { code?: unknown }).code;
    return code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR';
  }
}
