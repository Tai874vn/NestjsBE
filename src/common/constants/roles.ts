/**
 * Common authorization constants defining the `Role` enum (`user`, `employer`, `admin`) and the `ROLES_KEY` metadata key.
 * Shared by role decorators, guards, and feature controllers to enforce role-based access.
 *
 * Calls: nothing from this project
 * Used by:
 *   - 39 files, for example src/common/decorators/roles.decorator.ts, src/common/guards/roles.guard.ts, src/modules/admin/controllers/admin.controller.ts
 */

export const ROLES_KEY = 'roles';

export enum Role {
  USER = 'user',
  EMPLOYER = 'employer',
  ADMIN = 'admin',
}
