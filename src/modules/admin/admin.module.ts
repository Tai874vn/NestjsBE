/**
 * Admin feature module. It registers AdminController and AdminService for admin dashboard endpoints.
 *
 * Calls: AdminController; AdminService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { AdminController } from './controllers/admin.controller';
import { AdminService } from './services/admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
