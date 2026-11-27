/**
 * Common global role guard that enforces `@Roles(...)` metadata on HTTP routes.
 * Checks `request.user.role` against the required roles and throws 403 Forbidden when access is not allowed.
 *
 * Calls: ROLES_KEY; Role
 * Used by:
 *   - 10 files, for example src/app.module.ts, src/modules/admin/controllers/admin.controller.ts, src/modules/categories/controllers/categories.controller.ts
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLES_KEY } from '../constants/roles';

type RequestWithUser = {
  user?: {
    role?: Role;
  };
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user?.role) {
      throw new ForbiddenException('Authentication required');
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
