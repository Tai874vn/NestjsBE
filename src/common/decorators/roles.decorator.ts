/**
 * Common route metadata decorator `@Roles(...)` that marks which user roles may call a controller or handler.
 * Stores the required roles under `ROLES_KEY` for `RolesGuard` to check.
 *
 * Calls: ROLES_KEY; Role
 * Used by:
 *   - 11 files, for example src/modules/admin/controllers/admin.controller.ts, src/modules/auth/controllers/auth-sessions.controller.ts, src/modules/categories/controllers/categories.controller.ts
 */

import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../constants/roles';
import { Role } from '../constants/roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
