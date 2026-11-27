/**
 * Database service for the shared database layer.
 * Wraps PrismaClient with a PostgreSQL connection pool and handles opening and closing connections with the NestJS lifecycle.
 *
 * Calls: PostgreSQL via PrismaClient, PrismaPg, and pg Pool
 * Used by:
 *   - 51 files, for example src/app.service.ts, src/database/database.module.ts, src/modules/admin/services/admin.service.ts
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      connectionTimeoutMillis: Number(
        process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 10_000,
      ),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    });
    const adapter = new PrismaPg(pool);

    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }
}
