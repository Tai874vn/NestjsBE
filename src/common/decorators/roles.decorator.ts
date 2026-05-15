import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../constants/roles';
import { Role } from '../constants/roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
