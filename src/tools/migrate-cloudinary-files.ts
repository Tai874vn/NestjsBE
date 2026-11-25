import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
} from '../modules/storage/storage-paths';
import {
  StorageService,
  type StoredFileResult,
} from '../modules/storage/storage.service';

const CLOUDINARY_HOST = 'res.cloudinary.com';
const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface MigrationCounts {
  found: number;
  migrated: number;
  skipped: number;
  failed: number;
}

export interface MigrationSummary {
  dryRun: boolean;
  byField: Record<string, MigrationCounts>;
  totals: MigrationCounts;
}

function emptyCounts(): MigrationCounts {
  return { found: 0, migrated: 0, skipped: 0, failed: 0 };
}

/**
 * True only for HTTPS URLs hosted on our configured Cloudinary cloud name
 * (`https://res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/...`), with no credentials or custom port.
 */
export function isCloudinaryUrl(
  value: string | null | undefined,
  cloudName: string | undefined = process.env.CLOUDINARY_CLOUD_NAME,
): value is string {
  const expectedCloud = cloudName?.trim();
  if (!value || !expectedCloud) return false;
  try {
    const parsed = new URL(value.trim());
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      parsed.hostname.toLowerCase() === CLOUDINARY_HOST &&
      parsed.pathname.startsWith(`/${expectedCloud}/`)
    );
  } catch {
    return false;
  }
}

/**
 * Download a file from our Cloudinary account into memory with a strict byte cap,
 * timeout, and redirects disabled (prevents SSRF via 3xx redirects).
 */
export async function downloadCloudinaryFile(
  url: string,
  maxBytes: number,
  cloudName: string | undefined = process.env.CLOUDINARY_CLOUD_NAME,
): Promise<Buffer> {
  const rawUrl = url;
  if (!isCloudinaryUrl(url, cloudName)) {
    throw new Error(`Refused to download untrusted URL: ${rawUrl}`);
  }
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Remote file exceeds ${maxBytes} bytes`);
    }
  }

  if (!response.body) {
    throw new Error(`Empty response body for ${url}`);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const piece = Buffer.from(value);
      total += piece.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Remote file exceeds ${maxBytes} bytes`);
      }
      chunks.push(piece);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/**
 * One-off migration: finds every database value still pointing at our Cloudinary account,
 * downloads it, runs it through StorageService (sharp for images, signature + safety
 * checks for documents), stores it locally, and updates the database row.
 *
 * Safe to re-run (idempotent): already-migrated local paths are never touched again.
 * Note: the `cloudinary` package and `CLOUDINARY_*` env vars stay deprecated until this runs.
 */
export async function migrateCloudinaryFiles(
  prisma: PrismaClient,
  storage: StorageService,
  options: { dryRun: boolean; cloudName?: string },
): Promise<MigrationSummary> {
  const { dryRun } = options;
  const cloudName = (
    options.cloudName ?? process.env.CLOUDINARY_CLOUD_NAME
  )?.trim();
  const byField: Record<string, MigrationCounts> = {};
  // Only immutable snapshot tables (proposal_versions, contracts, submissions) reuse cached files.
  const immutableImageCache = new Map<string, StoredFileResult>();

  const countsOf = (field: string): MigrationCounts => {
    byField[field] ??= emptyCounts();
    return byField[field];
  };

  const migrateImageUrl = async (
    url: string,
    folder: string,
    deduplicate: boolean,
  ): Promise<{ stored: StoredFileResult; reused: boolean }> => {
    const cacheKey = `${folder}:${url}`;
    if (deduplicate) {
      const existing = immutableImageCache.get(cacheKey);
      if (existing) {
        return { stored: existing, reused: true };
      }
    }
    const buffer = await downloadCloudinaryFile(
      url,
      IMAGE_MAX_BYTES,
      cloudName,
    );
    const stored = await storage.saveImageBuffer(buffer, folder);
    if (deduplicate) {
      immutableImageCache.set(cacheKey, stored);
    }
    return { stored, reused: false };
  };

  const migrateSingleImageField = async <T extends { id: number }>(
    label: string,
    folder: string,
    rows: T[],
    getUrl: (row: T) => string | null,
    saveRow: (id: number, stored: StoredFileResult) => Promise<void>,
  ) => {
    const counts = countsOf(label);
    for (const row of rows) {
      const url = getUrl(row);
      if (!isCloudinaryUrl(url, cloudName)) {
        counts.skipped++;
        continue;
      }
      counts.found++;
      if (dryRun) {
        console.log(`[dry-run] ${label} #${row.id}: ${url}`);
        counts.skipped++;
        continue;
      }
      try {
        // Mutable rows always get their own UUID file so editing or deleting one row never deletes another row's image.
        const { stored } = await migrateImageUrl(url, folder, false);
        try {
          await saveRow(row.id, stored);
        } catch (dbError) {
          await storage.deleteImage(stored.key);
          throw dbError;
        }
        counts.migrated++;
      } catch (error) {
        counts.failed++;
        console.error(
          `[failed] ${label} #${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  const migrateImageArrayField = async <T extends { id: number }>(
    label: string,
    folder: string,
    rows: T[],
    getList: (row: T) => string[],
    saveRow: (id: number, updated: string[]) => Promise<void>,
  ) => {
    const counts = countsOf(label);
    for (const row of rows) {
      const list = getList(row);
      if (!list.some((item) => isCloudinaryUrl(item, cloudName))) continue;

      const updated: string[] = [];
      const createdKeys: Array<{ cacheKey: string; key: string }> = [];
      let rowHasChange = false;

      for (const item of list) {
        if (!isCloudinaryUrl(item, cloudName)) {
          updated.push(item);
          continue;
        }
        counts.found++;
        if (dryRun) {
          console.log(`[dry-run] ${label} #${row.id}: ${item}`);
          counts.skipped++;
          updated.push(item);
          continue;
        }
        try {
          const { stored, reused } = await migrateImageUrl(item, folder, true);
          if (!reused) {
            createdKeys.push({
              cacheKey: `${folder}:${item}`,
              key: stored.key,
            });
          }
          updated.push(stored.url);
          rowHasChange = true;
        } catch (error) {
          counts.failed++;
          updated.push(item);
          console.error(
            `[failed] ${label} #${row.id} (${item}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (!dryRun && rowHasChange) {
        const modifiedInRow = list.filter(
          (item, index) =>
            isCloudinaryUrl(item, cloudName) && updated[index] !== item,
        ).length;
        try {
          await saveRow(row.id, updated);
          counts.migrated += modifiedInRow;
        } catch (dbError) {
          for (const created of createdKeys) {
            await storage.deleteImage(created.key);
            immutableImageCache.delete(created.cacheKey);
          }
          // Every modified item in this row was rolled back, so always count them as failed.
          counts.failed += modifiedInRow;
          console.error(
            `[failed] ${label} #${row.id} DB update: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
          );
        }
      }
    }
  };

  const cloudinaryFilter = {
    contains: CLOUDINARY_HOST,
    mode: 'insensitive' as const,
  };

  // 1. User avatars
  const usersWithAvatar = await prisma.user.findMany({
    where: { avatar: cloudinaryFilter },
    select: { id: true, avatar: true },
  });
  await migrateSingleImageField(
    'users.avatar',
    'avatars',
    usersWithAvatar,
    (row) => row.avatar,
    async (id, stored) => {
      await prisma.user.update({ where: { id }, data: { avatar: stored.url } });
    },
  );

  // 2. User cover images
  const usersWithCover = await prisma.user.findMany({
    where: { coverImage: cloudinaryFilter },
    select: { id: true, coverImage: true },
  });
  await migrateSingleImageField(
    'users.coverImage',
    'covers',
    usersWithCover,
    (row) => row.coverImage,
    async (id, stored) => {
      await prisma.user.update({
        where: { id },
        data: { coverImage: stored.url },
      });
    },
  );

  // 3. Portfolio item images
  const portfolioItems = await prisma.userPortfolioItem.findMany({
    where: { image: cloudinaryFilter },
    select: { id: true, image: true },
  });
  await migrateSingleImageField(
    'user_portfolio_items.image',
    'portfolio',
    portfolioItems,
    (row) => row.image,
    async (id, stored) => {
      await prisma.userPortfolioItem.update({
        where: { id },
        data: { image: stored.url },
      });
    },
  );

  // 4. Subcategory images
  const subcategories = await prisma.subcategory.findMany({
    where: { image: cloudinaryFilter },
    select: { id: true, image: true },
  });
  await migrateSingleImageField(
    'subcategories.image',
    'subcategories',
    subcategories,
    (row) => row.image,
    async (id, stored) => {
      await prisma.subcategory.update({
        where: { id },
        data: { image: stored.url },
      });
    },
  );

  // 5. Job images
  const jobs = await prisma.job.findMany({
    where: { image: cloudinaryFilter },
    select: { id: true, image: true },
  });
  await migrateSingleImageField(
    'jobs.image',
    'jobs',
    jobs,
    (row) => row.image,
    async (id, stored) => {
      await prisma.job.update({ where: { id }, data: { image: stored.url } });
    },
  );

  // 6. Feed post images
  const posts = await prisma.post.findMany({
    where: { imageUrl: cloudinaryFilter },
    select: { id: true, imageUrl: true },
  });
  await migrateSingleImageField(
    'posts.imageUrl',
    'posts',
    posts,
    (row) => row.imageUrl,
    async (id, stored) => {
      await prisma.post.update({
        where: { id },
        data: { imageUrl: stored.url, imagePublicId: stored.key },
      });
    },
  );

  // 7. Proposal version referenceImages (immutable snapshots: deduplication allowed)
  const proposalVersions = await prisma.proposalVersion.findMany({
    where: { referenceImages: { isEmpty: false } },
    select: { id: true, referenceImages: true },
  });
  await migrateImageArrayField(
    'proposal_versions.referenceImages',
    'contracts',
    proposalVersions,
    (row) => row.referenceImages,
    async (id, referenceImages) => {
      await prisma.proposalVersion.update({
        where: { id },
        data: { referenceImages },
      });
    },
  );

  // 8. Contract referenceImages (immutable snapshots: deduplication allowed)
  const contracts = await prisma.contract.findMany({
    where: { referenceImages: { isEmpty: false } },
    select: { id: true, referenceImages: true },
  });
  await migrateImageArrayField(
    'contracts.referenceImages',
    'contracts',
    contracts,
    (row) => row.referenceImages,
    async (id, referenceImages) => {
      await prisma.contract.update({
        where: { id },
        data: { referenceImages },
      });
    },
  );

  // 9. Submission images (immutable snapshots: deduplication allowed)
  const submissions = await prisma.submission.findMany({
    where: { images: { isEmpty: false } },
    select: { id: true, images: true },
  });
  await migrateImageArrayField(
    'submissions.images',
    'contracts',
    submissions,
    (row) => row.images,
    async (id, images) => {
      await prisma.submission.update({ where: { id }, data: { images } });
    },
  );

  // 10. Private resume documents
  const resumes = await prisma.userResume.findMany({
    where: { sourceFileUrl: cloudinaryFilter },
    select: { id: true, sourceFileUrl: true },
  });
  const resumeCounts = countsOf('user_resumes.sourceFileUrl');
  for (const resume of resumes) {
    const url = resume.sourceFileUrl;
    if (!isCloudinaryUrl(url, cloudName)) {
      resumeCounts.skipped++;
      continue;
    }
    resumeCounts.found++;
    if (dryRun) {
      console.log(`[dry-run] user_resumes.sourceFileUrl #${resume.id}: ${url}`);
      resumeCounts.skipped++;
      continue;
    }
    try {
      const buffer = await downloadCloudinaryFile(
        url,
        DOCUMENT_MAX_BYTES,
        cloudName,
      );
      const stored = await storage.saveDocumentBuffer(buffer, 'resumes');
      try {
        await prisma.userResume.update({
          where: { id: resume.id },
          data: {
            sourceFileUrl: stored.key,
            sourceFilePublicId: stored.key,
            sourceFileMimeType: stored.mimeType,
            sourceFileSize: stored.size,
          },
        });
      } catch (dbError) {
        await storage.deleteDocument(stored.key);
        throw dbError;
      }
      resumeCounts.migrated++;
    } catch (error) {
      resumeCounts.failed++;
      console.error(
        `[failed] user_resumes.sourceFileUrl #${resume.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const totals = emptyCounts();
  for (const counts of Object.values(byField)) {
    totals.found += counts.found;
    totals.migrated += counts.migrated;
    totals.skipped += counts.skipped;
    totals.failed += counts.failed;
  }

  return { dryRun, byField, totals };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run migrate:files');
  }
  if (!process.env.CLOUDINARY_CLOUD_NAME?.trim()) {
    throw new Error('CLOUDINARY_CLOUD_NAME is required to run migrate:files');
  }

  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 10_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const storage = new StorageService();

  try {
    const summary = await migrateCloudinaryFiles(prisma, storage, { dryRun });
    console.log(
      `Cloudinary file migration (${dryRun ? 'dry-run' : 'live'}) finished:`,
    );
    console.log(JSON.stringify(summary, null, 2));
    if (summary.totals.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'File migration failed',
    );
    process.exitCode = 1;
  });
}
