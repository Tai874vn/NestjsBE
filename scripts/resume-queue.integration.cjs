/**
 * Integration test for the resume AI queue against a real PostgreSQL (2026-11-28).
 * The unit tests mock Prisma, so the claim SQL (FOR UPDATE SKIP LOCKED) never runs there. This script starts a
 * throwaway postgres:17-alpine container, applies the migrations, runs the real ResumeAiQueueService with a fake
 * AI service, and checks four things:
 *   1. four workers claiming at the same moment (like four backends) never process the same resume twice;
 *   2. a resume stuck in PROCESSING (a worker crashed) is claimed again after 5 minutes;
 *   3. a resume saved again while the AI was working keeps the newer result, not the old one;
 *   4. when the AI service is down, queued resumes become AI_UNAVAILABLE ("Try again").
 * The container is removed at the end. It never touches the real database.
 *
 * Run: npm run test:queue:integration   (needs Docker)
 * Calls: docker; prisma migrate deploy; ResumeAiQueueService; UserProfileNormalizerService
 * Used by:
 *   - package.json (test:queue:integration)
 */
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
require('reflect-metadata');
require('ts-node/register/transpile-only');

const pgName = `jobaura-queue-test-${Date.now()}-pg`;
const password = 'isolated-fixture-password-not-production';
// A real occupation code from the catalogue (web developer), so the worker asks for a seniority level.
const OCCUPATION = '2513.5';
const RESUMES = 60;
const WORKERS = 4;

const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

let passed = 0;
async function check(name, operation) {
  await operation();
  passed++;
  console.log(`PASS ${name}`);
}

/**
 * A fake AI service. It counts how often each user's resume reaches the seniority step and waits a little, so
 * the workers really overlap. `onPredict` lets a check act in the middle of the AI work.
 * With `together` = N, the first N availability checks wait for each other, so N workers send their claim
 * query at the same moment (the race FOR UPDATE SKIP LOCKED must win).
 */
function fakeAi(together = 0) {
  const calls = new Map();
  const waiting = [];
  const ai = {
    up: true,
    onPredict: null,
    isAvailable: async () => {
      if (waiting.length < together) {
        await new Promise((resolve) => {
          waiting.push(resolve);
          if (waiting.length === together)
            waiting.forEach((release) => release());
        });
      }
      return ai.up;
    },
    resolveSkills: async (names) => names.map((name) => ({ name })),
    extractSkills: async () => [],
    predictResumeSeniority: async ({ resume }) => {
      const key = resume.role;
      const count = (calls.get(key) ?? 0) + 1;
      calls.set(key, count);
      if (ai.onPredict) await ai.onPredict(key, count);
      await delay(20);
      return {
        label: count === 1 ? 'Junior' : 'Senior',
        confidence: 0.9,
        probabilities: {},
        features: {},
        model: 'fake',
        elapsed_ms: 1,
      };
    },
  };
  return { ai, calls };
}

(async () => {
  let pool;
  let prisma;
  try {
    docker(
      'run',
      '-d',
      '--name',
      pgName,
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_USER=audit',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=queue_test',
      'postgres:17-alpine',
    );
    for (let i = 0; i < 60; i++) {
      try {
        if (
          docker(
            'exec',
            pgName,
            'pg_isready',
            '-U',
            'audit',
            '-d',
            'queue_test',
          ).includes('accepting connections')
        )
          break;
      } catch {
        /* not up yet */
      }
      await delay(500);
    }
    const port = docker('port', pgName, '5432/tcp').split(':').at(-1);
    const databaseUrl = `postgresql://audit:${password}@127.0.0.1:${port}/queue_test?schema=public`;
    const migrated = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 120000,
      },
    );
    assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);

    const { PrismaClient } = require('@prisma/client');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { Pool } = require('pg');
    const {
      ResumeAiQueueService,
    } = require('../src/modules/users/services/resume-ai-queue.service');
    const {
      UserProfileNormalizerService,
    } = require('../src/modules/users/services/user-profile-normalizer.service');
    pool = new Pool({ connectionString: databaseUrl });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    const noCache = { invalidateUserCaches: async () => undefined };
    const noTimer = { get: () => '0' }; // RESUME_AI_QUEUE_INTERVAL_MS = 0: no background timer, we call processQueue.
    const worker = (ai) =>
      new ResumeAiQueueService(
        prisma,
        noCache,
        ai,
        new UserProfileNormalizerService(),
        noTimer,
      );

    /** Create users whose resumes wait in the queue. The role names the resume so the fake AI can count it. */
    async function queueResumes(prefix, count, extra = {}) {
      const ids = [];
      for (let i = 0; i < count; i++) {
        const user = await prisma.user.create({
          data: { name: `${prefix} ${i}`, email: `${prefix}-${i}@queue.test` },
        });
        await prisma.userResume.create({
          data: {
            userId: user.id,
            data: { Occupation: OCCUPATION, Role: `${prefix}-${i}` },
            aiStatus: 'QUEUED',
            aiQueuedAt: new Date(Date.now() - (count - i) * 1000),
            ...extra,
          },
        });
        ids.push(user.id);
      }
      return ids;
    }
    const statuses = async (ids) =>
      (
        await prisma.userResume.findMany({
          where: { userId: { in: ids } },
          select: { aiStatus: true },
        })
      ).map((r) => r.aiStatus);

    await check(
      `${WORKERS} workers claiming at the same moment process each of ${RESUMES} resumes exactly once`,
      async () => {
        const { ai, calls } = fakeAi(WORKERS);
        const ids = await queueResumes('pair', RESUMES);
        await Promise.all(
          Array.from({ length: WORKERS }, () => worker(ai).processQueue()),
        );
        assert.equal(calls.size, RESUMES, 'every resume reached the AI');
        assert.deepEqual(
          [...calls.values()].filter((n) => n !== 1),
          [],
          'no resume was processed twice',
        );
        assert.deepEqual([...new Set(await statuses(ids))], ['DONE']);
      },
    );

    await check(
      'a resume stuck in PROCESSING for over 5 minutes is claimed again and finishes',
      async () => {
        const { ai } = fakeAi();
        const [id] = await queueResumes('stuck', 1, {
          aiStatus: 'PROCESSING',
          aiClaimedAt: new Date(Date.now() - 6 * 60_000),
        });
        await worker(ai).processQueue();
        const row = await prisma.userResume.findUnique({
          where: { userId: id },
        });
        assert.equal(row.aiStatus, 'DONE');
        assert.equal(row.aiAttempts, 1);
      },
    );

    await check(
      'a resume saved again during the AI work keeps the newer result',
      async () => {
        const { ai, calls } = fakeAi();
        const [id] = await queueResumes('resaved', 1);
        // During the first AI call the user saves again: the save sets QUEUED and a new aiQueuedAt (as importResume does).
        ai.onPredict = async (key, count) => {
          if (count === 1)
            await prisma.userResume.update({
              where: { userId: id },
              data: { aiStatus: 'QUEUED', aiQueuedAt: new Date() },
            });
        };
        const queue = worker(ai);
        await queue.processQueue();
        if (calls.get('resaved-0') < 2) await queue.processQueue();
        const row = await prisma.userResume.findUnique({
          where: { userId: id },
        });
        assert.equal(
          calls.get('resaved-0'),
          2,
          'the newer save was processed too',
        );
        assert.equal(
          row.predictedSeniority,
          'Senior',
          'the old result (Junior) was not written over the newer one',
        );
        assert.equal(row.aiStatus, 'DONE');
      },
    );

    await check(
      'when the AI service is down, queued resumes are handed back as AI_UNAVAILABLE',
      async () => {
        const { ai, calls } = fakeAi();
        ai.up = false;
        const ids = await queueResumes('down', 3);
        await worker(ai).processQueue();
        assert.equal(calls.size, 0);
        assert.deepEqual([...new Set(await statuses(ids))], ['AI_UNAVAILABLE']);
      },
    );

    console.log(`\n${passed} queue integration checks passed`);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    try {
      docker('rm', '-f', '-v', pgName);
    } catch {
      /* the container may not have started */
    }
  }
})();
