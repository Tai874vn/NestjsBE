/**
 * Root App module service that handles the API greeting and database readiness check.
 * Runs a lightweight `SELECT 1` query to verify Postgres connectivity and throws 503 if unavailable.
 *
 * Calls: PrismaService
 * Used by:
 *   - src/app.controller.ts
 *   - src/app.module.ts
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  // GET /api/ — Plain hello text at the API root.
  getHello(): string {
    return 'Hello World!';
  }

  // GET /api/health/ready — Readiness check: "ready" only when the database answers.
  // Query: raw SQL SELECT 1
  async getReadiness(): Promise<{ status: 'ready' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch (error) {
      throw new ServiceUnavailableException('Database is not ready', {
        cause: error,
      });
    }
  }
}
