import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { loadJobTaxonomy, syncJobTaxonomy } from './job-taxonomy';

/**
 * Replace the job categories with JobAura's career-field taxonomy.
 *   npm run db:taxonomy            -> show the plan only
 *   npm run db:taxonomy -- --apply -> apply it in one transaction
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const taxonomy = loadJobTaxonomy();
    const plan = apply
      ? await prisma.$transaction(
          (tx) => syncJobTaxonomy(tx, taxonomy, { apply: true }),
          { timeout: 120_000 },
        )
      : await syncJobTaxonomy(prisma, taxonomy, { apply: false });
    console.log(JSON.stringify(plan, null, 2));
    console.log(
      apply
        ? 'Applied. Clear the category caches (or restart the API) so lists refresh.'
        : 'Dry run only. Run again with --apply to make these changes.',
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
