import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { AddressInfo } from 'node:net';
import { devPublicImages } from '../dev-public-images';

describe('devPublicImages', () => {
  it('is off in production', () => {
    expect(devPublicImages('production', '/x')).toBeNull();
  });

  it('serves only public images in development, with nosniff', async () => {
    const root = mkdtempSync(join(tmpdir(), 'uploads-'));
    mkdirSync(join(root, 'public', 'images', 'avatars'), { recursive: true });
    mkdirSync(join(root, 'private'), { recursive: true });
    writeFileSync(join(root, 'public', 'images', 'avatars', 'a.webp'), 'img');
    writeFileSync(join(root, 'private', 'cv.pdf'), 'secret');
    const app = express();
    app.use('/uploads/images', devPublicImages('development', root)!);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const ok = await fetch(`${base}/uploads/images/avatars/a.webp`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await fetch(`${base}/uploads/images/../private/cv.pdf`)).status).not.toBe(200);
      expect((await fetch(`${base}/uploads/images/%2e%2e/private/cv.pdf`)).status).not.toBe(200);
      expect((await fetch(`${base}/uploads/images/avatars/`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
