/**
 * Common local-development middleware helper that serves public uploaded images from `<UPLOADS_DIR>/public/images`.
 * Returns `null` in production so nginx stays the only static file server; private files are never served here.
 *
 * Calls: resolveUploadsDir
 * Used by:
 *   - src/main.ts
 */

import { join } from 'node:path';
import express from 'express';
import { resolveUploadsDir } from '../../modules/storage/utils/storage-paths';

/**
 * Local development only: serve the public images (`<UPLOADS_DIR>/public/images`) at
 * `/uploads/images`, which nginx does in production. CVs and other private files are never served
 * here; they stay behind the signed-in FilesController.
 * Returns null in production, so production keeps nginx as the only static file server.
 */
export function devPublicImages(
  nodeEnv = process.env.NODE_ENV,
  uploadsDir = process.env.UPLOADS_DIR,
): express.RequestHandler | null {
  if (nodeEnv === 'production') return null;
  const root = join(
    resolveUploadsDir({ uploadsDir, nodeEnv }),
    'public',
    'images',
  );
  return express.static(root, {
    dotfiles: 'deny',
    index: false,
    redirect: false,
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=300');
    },
  });
}
