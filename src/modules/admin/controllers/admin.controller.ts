/**
 * HTTP controller for the admin feature, restricted to ADMIN users. Routes: GET /api/admin/stats -> getStats().
 *
 * Calls: AdminService; JwtAuthGuard; RolesGuard; Roles; Role
 * Used by:
 *   - src/modules/admin/admin.module.ts
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AdminService } from '../services/admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }
}
