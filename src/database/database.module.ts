/**
 * Global database module for the app. It registers and exports PrismaService so every feature module can access PostgreSQL.
 *
 * Calls: PrismaService
 * Used by:
 *   - src/app.module.ts
 */

import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
