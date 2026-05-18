import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../constants/roles';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const handler = jest.fn();
  const targetClass = class TestClass {};

  const createContext = (role?: Role): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => targetClass,
      switchToHttp: () => ({
        getRequest: () => ({
          user: role ? { role } : undefined,
        }),
      }),
    }) as ExecutionContext;

  it('allows access when no required roles are configured', () => {
    const reflector: Pick<Reflector, 'getAllAndOverride'> = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };

    const guard = new RolesGuard(reflector as Reflector);

    expect(guard.canActivate(createContext(Role.USER))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [
      handler,
      targetClass,
    ]);
  });

  it('allows access when user has one of required roles', () => {
    const reflector: Pick<Reflector, 'getAllAndOverride'> = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]),
    };

    const guard = new RolesGuard(reflector as Reflector);

    expect(guard.canActivate(createContext(Role.ADMIN))).toBe(true);
  });

  it('throws when user is missing role information', () => {
    const reflector: Pick<Reflector, 'getAllAndOverride'> = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]),
    };

    const guard = new RolesGuard(reflector as Reflector);

    expect(() => guard.canActivate(createContext())).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(createContext())).toThrow(
      'Authentication required',
    );
  });

  it('throws when user role is insufficient', () => {
    const reflector: Pick<Reflector, 'getAllAndOverride'> = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]),
    };

    const guard = new RolesGuard(reflector as Reflector);

    expect(() => guard.canActivate(createContext(Role.USER))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(createContext(Role.USER))).toThrow(
      'Insufficient permissions',
    );
  });
});
