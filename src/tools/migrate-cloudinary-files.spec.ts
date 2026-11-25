import {
  downloadCloudinaryFile,
  isCloudinaryUrl,
  migrateCloudinaryFiles,
} from './migrate-cloudinary-files';
import type { StorageService } from '../modules/storage/storage.service';

function makeMockPrisma() {
  return {
    user: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    userPortfolioItem: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    subcategory: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    job: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    post: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    proposalVersion: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    contract: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    submission: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    userResume: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };
}

function makeFakeFetchResponse(body: Buffer, status = 200) {
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-length': String(body.length) }),
    body: {
      getReader: () => ({
        read: () => {
          if (sent) return Promise.resolve({ done: true, value: undefined });
          sent = true;
          return Promise.resolve({ done: false, value: new Uint8Array(body) });
        },
        cancel: jest.fn(),
        releaseLock: jest.fn(),
      }),
    },
  };
}

describe('migrate-cloudinary-files (Findings 5 & 11)', () => {
  const cloudName = 'jobaura-prod';
  const validUrlA = `https://res.cloudinary.com/${cloudName}/image/upload/v1/a.png`;
  const validUrlB = `https://res.cloudinary.com/${cloudName}/image/upload/v1/b.png`;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isCloudinaryUrl', () => {
    it('accepts only HTTPS URLs under the configured Cloudinary cloud name', () => {
      expect(isCloudinaryUrl(validUrlA, cloudName)).toBe(true);
      expect(
        isCloudinaryUrl(
          `https://RES.CLOUDINARY.COM/${cloudName}/image/upload/v1/a.png`,
          cloudName,
        ),
      ).toBe(true);
    });

    it.each([
      ['HTTP downgrade', `http://res.cloudinary.com/${cloudName}/image/upload/a.png`],
      ['different cloud name', 'https://res.cloudinary.com/attacker-cloud/image/upload/a.png'],
      ['path traversal into another cloud', `https://res.cloudinary.com/${cloudName}/../attacker/a.png`],
      ['embedded credentials', `https://user:pass@res.cloudinary.com/${cloudName}/image/upload/a.png`],
      ['custom port', `https://res.cloudinary.com:8443/${cloudName}/image/upload/a.png`],
      ['foreign host', `https://evil.com/${cloudName}/image/upload/a.png`],
    ])('rejects untrusted URL (%s)', (_label, url) => {
      expect(isCloudinaryUrl(url, cloudName)).toBe(false);
    });

    it('returns false when CLOUDINARY_CLOUD_NAME is missing', () => {
      expect(isCloudinaryUrl(validUrlA, '')).toBe(false);
      expect(isCloudinaryUrl(validUrlA, undefined)).toBe(false);
    });
  });

  describe('downloadCloudinaryFile', () => {
    it('disables redirects (redirect: "error") to prevent SSRF', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(makeFakeFetchResponse(Buffer.from('ok')) as never);

      const bytes = await downloadCloudinaryFile(validUrlA, 1024, cloudName);
      expect(bytes.toString()).toBe('ok');
      expect(fetchSpy).toHaveBeenCalledWith(
        validUrlA,
        expect.objectContaining({ redirect: 'error' }),
      );
    });

    it('rejects untrusted URLs before calling fetch', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(
        downloadCloudinaryFile(
          'https://res.cloudinary.com/other-cloud/image/upload/a.png',
          1024,
          cloudName,
        ),
      ).rejects.toThrow(/untrusted/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('migrateCloudinaryFiles', () => {
    it('writes separate UUID files for mutable rows sharing a URL, and deduplicates immutable snapshots', async () => {
      const prisma = makeMockPrisma();
      prisma.job.findMany.mockResolvedValue([
        { id: 1, image: validUrlA },
        { id: 2, image: validUrlA },
      ]);
      prisma.proposalVersion.findMany.mockResolvedValue([
        { id: 10, referenceImages: [validUrlA] },
      ]);
      prisma.contract.findMany.mockResolvedValue([
        { id: 20, referenceImages: [validUrlA] },
      ]);

      jest
        .spyOn(global, 'fetch')
        .mockImplementation(() =>
          Promise.resolve(makeFakeFetchResponse(Buffer.from('img')) as never),
        );

      let counter = 0;
      const storage = {
        saveImageBuffer: jest.fn((_buf: Buffer, folder: string) => {
          counter++;
          const key = `images/${folder}/00000000-0000-4000-8000-00000000000${counter}.webp`;
          return Promise.resolve({
            url: `/uploads/${key}`,
            key,
            mimeType: 'image/webp',
            size: 3,
          });
        }),
        deleteImage: jest.fn().mockResolvedValue(undefined),
        saveDocumentBuffer: jest.fn(),
        deleteDocument: jest.fn(),
      } as unknown as StorageService;

      const summary = await migrateCloudinaryFiles(prisma as never, storage, {
        dryRun: false,
        cloudName,
      });

      // Two mutable job rows get two distinct local files.
      expect(prisma.job.update).toHaveBeenNthCalledWith(1, {
        where: { id: 1 },
        data: {
          image:
            '/uploads/images/jobs/00000000-0000-4000-8000-000000000001.webp',
        },
      });
      expect(prisma.job.update).toHaveBeenNthCalledWith(2, {
        where: { id: 2 },
        data: {
          image:
            '/uploads/images/jobs/00000000-0000-4000-8000-000000000002.webp',
        },
      });

      // Immutable proposalVersion + contract reuse the same deduplicated file.
      const sharedContractUrl =
        '/uploads/images/contracts/00000000-0000-4000-8000-000000000003.webp';
      expect(prisma.proposalVersion.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { referenceImages: [sharedContractUrl] },
      });
      expect(prisma.contract.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: { referenceImages: [sharedContractUrl] },
      });
      expect(summary.totals).toEqual({
        found: 4,
        migrated: 4,
        skipped: 0,
        failed: 0,
      });
    });

    it('counts rolled-back array items accurately when one item fails download and DB update also fails (Finding 11)', async () => {
      const prisma = makeMockPrisma();
      prisma.contract.findMany.mockResolvedValue([
        { id: 5, referenceImages: [validUrlA, validUrlB] },
      ]);
      prisma.contract.update.mockRejectedValue(new Error('db constraint failed'));

      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(global, 'fetch').mockImplementation((url) => {
        if (url === validUrlA) {
          return Promise.resolve(
            makeFakeFetchResponse(Buffer.from('ok')) as never,
          );
        }
        return Promise.resolve(makeFakeFetchResponse(Buffer.alloc(0), 404) as never);
      });

      const createdKey =
        'images/contracts/550e8400-e29b-41d4-a716-446655440000.webp';
      const deleteImage = jest.fn().mockResolvedValue(undefined);
      const storage = {
        saveImageBuffer: jest.fn().mockResolvedValue({
          url: `/uploads/${createdKey}`,
          key: createdKey,
          mimeType: 'image/webp',
          size: 2,
        }),
        deleteImage,
        saveDocumentBuffer: jest.fn(),
        deleteDocument: jest.fn(),
      } as unknown as StorageService;

      const summary = await migrateCloudinaryFiles(prisma as never, storage, {
        dryRun: false,
        cloudName,
      });

      expect(deleteImage).toHaveBeenCalledWith(createdKey);
      expect(summary.byField['contracts.referenceImages']).toEqual({
        found: 2,
        migrated: 0,
        skipped: 0,
        failed: 2,
      });
    });

    it('uses case-insensitive contains filters in Prisma queries (Finding 11)', async () => {
      const prisma = makeMockPrisma();
      const storage = {} as StorageService;

      await migrateCloudinaryFiles(prisma as never, storage, {
        dryRun: true,
        cloudName,
      });

      const insensitiveFilter = {
        contains: 'res.cloudinary.com',
        mode: 'insensitive',
      };
      expect(prisma.user.findMany).toHaveBeenNthCalledWith(1, {
        where: { avatar: insensitiveFilter },
        select: { id: true, avatar: true },
      });
      expect(prisma.user.findMany).toHaveBeenNthCalledWith(2, {
        where: { coverImage: insensitiveFilter },
        select: { id: true, coverImage: true },
      });
      expect(prisma.userPortfolioItem.findMany).toHaveBeenCalledWith({
        where: { image: insensitiveFilter },
        select: { id: true, image: true },
      });
      expect(prisma.subcategory.findMany).toHaveBeenCalledWith({
        where: { image: insensitiveFilter },
        select: { id: true, image: true },
      });
      expect(prisma.job.findMany).toHaveBeenCalledWith({
        where: { image: insensitiveFilter },
        select: { id: true, image: true },
      });
      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: { imageUrl: insensitiveFilter },
        select: { id: true, imageUrl: true },
      });
      expect(prisma.userResume.findMany).toHaveBeenCalledWith({
        where: { sourceFileUrl: insensitiveFilter },
        select: { id: true, sourceFileUrl: true },
      });
    });
  });
});
