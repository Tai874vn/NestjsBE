import { BadRequestException } from '@nestjs/common';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_INPUT_PIXELS = 40_000_000;

export const IMAGE_MAX_SIDE_BY_FOLDER: Record<string, number> = {
  avatars: 512,
  covers: 1600,
};
export const DEFAULT_IMAGE_MAX_SIDE = 2000;

export type StorageArea = 'public' | 'private';
export type DocumentExtension = '.pdf' | '.docx';

export const DOCUMENT_MIME_BY_EXT: Record<DocumentExtension, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const FOLDER_PATTERN = /^[a-z0-9_-]{1,64}$/;
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGE_KEY_PATTERN = new RegExp(
  `^images/[a-z0-9_-]{1,64}/${UUID_PATTERN}\\.webp$`,
);
const DOCUMENT_KEY_PATTERN = new RegExp(
  `^documents/[a-z0-9_-]{1,64}/${UUID_PATTERN}\\.(pdf|docx)$`,
);
const LOCAL_IMAGE_URL_PATTERN = new RegExp(
  `^/uploads/images/[a-z0-9_-]{1,64}/${UUID_PATTERN}\\.webp$`,
);

/** Turn one or more configured public URLs into normalized origins (`https://host`). */
export function parseAllowedOrigins(
  ...rawValues: Array<string | undefined | null>
): Set<string> {
  const origins = new Set<string>();
  for (const raw of rawValues) {
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          origins.add(parsed.origin);
        }
      } catch {
        // Ignore malformed entries so one bad value never breaks key extraction.
      }
    }
  }
  return origins;
}

/**
 * Pick the root folder where uploaded files live on disk.
 * Production defaults to `/app/uploads` (the Docker volume); local dev uses `./uploads`.
 */
export function resolveUploadsDir(config?: {
  uploadsDir?: string;
  nodeEnv?: string;
}): string {
  const configured = config?.uploadsDir?.trim();
  if (configured) {
    return resolve(configured);
  }
  return resolve(
    config?.nodeEnv === 'production' ? '/app/uploads' : './uploads',
  );
}

/** Max width/height in pixels for each image folder. */
export function maxSideForImageFolder(folder: string): number {
  return IMAGE_MAX_SIDE_BY_FOLDER[folder] ?? DEFAULT_IMAGE_MAX_SIDE;
}

/** Check that a folder name is one safe lowercase segment (never slashes or `..`). */
export function normalizeFolderName(folder: string): string {
  const trimmed = folder.trim().toLowerCase();
  if (!FOLDER_PATTERN.test(trimmed)) {
    throw new BadRequestException('Invalid upload folder.');
  }
  return trimmed;
}

/** Build the stable public URL stored in the database for an image key. */
export function buildImageUrl(key: string): string {
  if (!IMAGE_KEY_PATTERN.test(key)) {
    throw new BadRequestException('Invalid image key.');
  }
  return `/uploads/${key}`;
}

/** Build the authenticated download path for a private document key. */
export function buildDocumentUrl(key: string): string {
  if (!DOCUMENT_KEY_PATTERN.test(key)) {
    throw new BadRequestException('Invalid document key.');
  }
  return `/api/files/${key}`;
}

/**
 * Turn a database `sourceFileUrl` value into the URL the API sends to clients.
 * Local keys (`documents/resumes/<uuid>.pdf`) become `/api/files/documents/resumes/<uuid>.pdf`.
 * Legacy external URLs (before migration finishes) pass through unchanged.
 */
export function toPublicDocumentUrl(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  const value = stored.trim();
  if (!value) return null;
  if (DOCUMENT_KEY_PATTERN.test(value)) {
    return `/api/files/${value}`;
  }
  if (value.startsWith('/api/files/documents/')) {
    const key = extractStorageKey(value);
    return key ? `/api/files/${key}` : null;
  }
  if (value.startsWith('https://') || value.startsWith('http://')) {
    return value;
  }
  return null;
}

/** True when `value` is a clean relative image URL served by our own `/uploads/images/` path. */
export function isLocalImageUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 500) return false;
  return LOCAL_IMAGE_URL_PATTERN.test(value);
}

/**
 * Pull a clean storage key (`images/<folder>/<uuid>.webp` or `documents/<folder>/<uuid>.<ext>`)
 * out of a relative URL, a same-origin absolute URL, or a raw key.
 * Returns null for untrusted external hosts (such as Cloudinary or arbitrary domains) or traversal attempts.
 */
export function extractStorageKey(
  value: string | null | undefined,
  allowedOrigins?: ReadonlySet<string>,
): string | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\0') || trimmed.includes('\\')) {
    return null;
  }

  let candidate = trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const origins =
        allowedOrigins ??
        parseAllowedOrigins(
          process.env.FRONTEND_URL,
          process.env.DEV_FRONTEND_ORIGINS,
        );
      if (!origins.has(parsed.origin)) {
        return null;
      }
      candidate = parsed.pathname;
    } catch {
      return null;
    }
  }

  if (candidate.startsWith('/uploads/')) {
    candidate = candidate.slice('/uploads/'.length);
  } else if (candidate.startsWith('/api/files/')) {
    candidate = candidate.slice('/api/files/'.length);
  }

  if (
    IMAGE_KEY_PATTERN.test(candidate) ||
    DOCUMENT_KEY_PATTERN.test(candidate)
  ) {
    return candidate;
  }
  return null;
}

/** Return the allowed MIME type and extension for a validated document key, or null. */
export function documentMetaFromKey(
  key: string,
): { extension: DocumentExtension; contentType: string } | null {
  if (!DOCUMENT_KEY_PATTERN.test(key)) return null;
  if (key.endsWith('.pdf')) {
    return { extension: '.pdf', contentType: DOCUMENT_MIME_BY_EXT['.pdf'] };
  }
  if (key.endsWith('.docx')) {
    return { extension: '.docx', contentType: DOCUMENT_MIME_BY_EXT['.docx'] };
  }
  return null;
}

/**
 * Resolve a relative storage path inside `<uploadsDir>/<area>` and verify it cannot escape.
 * Throws 400 on any traversal segment, absolute path, backslash or null byte.
 */
export function resolveSafeStoragePath(
  uploadsDir: string,
  area: StorageArea,
  relativeKey: string,
): string {
  if (
    !relativeKey ||
    relativeKey.includes('\0') ||
    relativeKey.includes('\\') ||
    relativeKey.startsWith('/')
  ) {
    throw new BadRequestException('Invalid file path.');
  }

  const segments = relativeKey.split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    throw new BadRequestException('Invalid file path.');
  }

  const baseDir = resolve(uploadsDir, area);
  const targetPath = resolve(baseDir, ...segments);
  const rel = relative(baseDir, targetPath);

  if (
    !rel ||
    rel.startsWith('..') ||
    isAbsolute(rel) ||
    !targetPath.startsWith(`${baseDir}${sep}`)
  ) {
    throw new BadRequestException('Invalid file path.');
  }

  return targetPath;
}
