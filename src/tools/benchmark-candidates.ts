/**
 * Standalone benchmark script for the users feature (candidate directory).
 * Measures query latency and result stability for candidate search scenarios against a read-only PostgreSQL session and outputs JSON metrics.
 *
 * Calls: CandidateDirectoryService; UserProfileNormalizerService; CandidateDirectoryQueryDto; PostgreSQL via PrismaClient, PrismaPg, and pg Pool
 * Used by:
 *   - run by hand: npm run benchmark:candidates
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaService } from '../prisma.service';
import { CandidateDirectoryQueryDto } from '../modules/users/dto/candidate-directory-query.dto';
import { CandidateDirectoryService } from '../modules/users/services/candidate-directory.service';
import { UserProfileNormalizerService } from '../modules/users/services/user-profile-normalizer.service';

const SCENARIOS: Array<{
  name: string;
  query: CandidateDirectoryQueryDto;
}> = [
  { name: 'directory_page_1', query: { page: 1, pageSize: 10 } },
  { name: 'directory_page_10', query: { page: 10, pageSize: 10 } },
  {
    name: 'keyword_python',
    query: { page: 1, pageSize: 10, keyword: 'Python' },
  },
  {
    name: 'keyword_production',
    query: { page: 1, pageSize: 10, keyword: 'production' },
  },
  {
    name: 'keyword_project',
    query: { page: 1, pageSize: 10, keyword: 'project' },
  },
  {
    name: 'skill_and_location',
    query: { page: 1, pageSize: 10, skill: 'React', location: 'Remote' },
  },
];

export function readOnlyDatabaseUrl(value: string) {
  const url = new URL(value);
  const options = url.searchParams.get('options') ?? '';
  url.searchParams.set(
    'options',
    `${options} -c default_transaction_read_only=on`.trim(),
  );
  return url.toString();
}

export async function disconnectBenchmark(
  prisma: Pick<PrismaClient, '$disconnect'>,
  pool: Pick<Pool, 'end'>,
) {
  try {
    await prisma.$disconnect();
  } finally {
    await pool.end();
  }
}

export function summarizeTimings(times: number[]) {
  if (
    !times.length ||
    times.some((time) => !Number.isFinite(time) || time < 0)
  ) {
    throw new Error('Timing samples must be nonempty, finite, and nonnegative');
  }
  const sorted = [...times].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  const round = (value: number) => Number(value.toFixed(2));
  return {
    samples: sorted.length,
    min_ms: round(sorted[0]),
    median_ms: round(median),
    p95_ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max_ms: round(sorted[sorted.length - 1]),
  };
}

export function parseBenchmarkOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      samples: { type: 'string', default: '30' },
      warmup: { type: 'string', default: '5' },
      output: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const samples = Number(values.samples);
  const warmup = Number(values.warmup);
  if (!Number.isInteger(samples) || samples < 1 || samples > 1000) {
    throw new Error('--samples must be an integer from 1 to 1000');
  }
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 100) {
    throw new Error('--warmup must be an integer from 0 to 100');
  }
  return { samples, warmup, output: values.output, help: values.help ?? false };
}

export async function measureCandidateScenarios(
  service: Pick<CandidateDirectoryService, 'findCandidates'>,
  options: { samples: number; warmup: number },
) {
  const measurements: Array<{
    scenario: string;
    query: CandidateDirectoryQueryDto;
    matched: number;
    returned: number;
    resultFingerprint: string;
    timing: ReturnType<typeof summarizeTimings>;
  }> = [];

  for (const { name, query } of SCENARIOS) {
    for (let i = 0; i < options.warmup; i++) {
      await service.findCandidates(query);
    }
    const times: number[] = [];
    let resultFingerprint = '';
    let result!: Awaited<
      ReturnType<CandidateDirectoryService['findCandidates']>
    >;
    for (let i = 0; i < options.samples; i++) {
      const start = performance.now();
      result = await service.findCandidates(query);
      times.push(performance.now() - start);
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(result))
        .digest('hex');
      if (resultFingerprint && fingerprint !== resultFingerprint) {
        throw new Error(
          `Candidate results changed during ${name}; rerun with a stable dataset`,
        );
      }
      resultFingerprint = fingerprint;
    }
    measurements.push({
      scenario: name,
      query,
      matched: result.content.total,
      returned: result.content.data.length,
      resultFingerprint,
      timing: summarizeTimings(times),
    });
  }

  return measurements;
}

async function main() {
  const options = parseBenchmarkOptions(process.argv.slice(2));
  if (options.help) {
    console.log(
      'yarn benchmark:candidates [--samples 30] [--warmup 5] [--output docs/performance/results.json]',
    );
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to the database being measured');
  }
  const pool = new Pool({
    connectionString: readOnlyDatabaseUrl(process.env.DATABASE_URL),
    max: 2,
    connectionTimeoutMillis: 10_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    await prisma.$connect();
    const environment = await prisma.$queryRaw<
      Array<{
        postgres_version: string;
        read_only: string;
        users: number;
        eligible_candidates: number;
        portfolio_items: number;
      }>
    >`
      SELECT current_setting('server_version') AS postgres_version,
             current_setting('transaction_read_only') AS read_only,
             (SELECT COUNT(*) FROM users)::int AS users,
             (SELECT COUNT(*) FROM users WHERE role = 'user' AND "candidateDiscoverable")::int AS eligible_candidates,
             (SELECT COUNT(*) FROM user_portfolio_items)::int AS portfolio_items
    `;
    if (environment[0]?.read_only !== 'on') {
      throw new Error('Benchmark requires a read-only database session');
    }
    const indexes = await prisma.$queryRaw<
      Array<{ name: string; definition: string; size_bytes: number }>
    >`
      SELECT c.relname AS name, pg_get_indexdef(c.oid) AS definition,
             pg_relation_size(c.oid)::float8 AS size_bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN (
        'users_bio_trgm_idx', 'user_portfolio_items_title_trgm_idx',
        'user_portfolio_items_description_trgm_idx'
      ) ORDER BY c.relname
    `;
    const service = new CandidateDirectoryService(
      prisma as PrismaService,
      new UserProfileNormalizerService(),
    );
    const results = {
      generatedAt: new Date().toISOString(),
      measurement:
        'Prisma queries and service processing; excludes HTTP and JSON serialization',
      settings: {
        samples: options.samples,
        warmup: options.warmup,
        pool_max: 2,
      },
      environment: {
        ...environment[0],
        node_version: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      indexes,
      scenarios: await measureCandidateScenarios(service, options),
    };
    const json = JSON.stringify(results, null, 2);
    if (options.output) {
      const output = resolve(options.output);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, json + '\n', 'utf8');
    }
    console.log(json);
  } finally {
    await disconnectBenchmark(prisma, pool);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Benchmark failed');
    process.exitCode = 1;
  });
}
