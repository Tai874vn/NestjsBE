import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const parentPrototype = Object.getPrototypeOf(
    JwtAuthGuard.prototype,
  ) as typeof JwtAuthGuard.prototype & {
    canActivate: (context: ExecutionContext) => boolean | Promise<boolean>;
  };

  const createContext = (): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
    }) as unknown as ExecutionContext;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows public routes without calling passport auth guard', () => {
    const reflector: Pick<Reflector, 'getAllAndOverride'> = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    };

    const superSpy = jest
      .spyOn(parentPrototype, 'canActivate')
      .mockReturnValue(false);
    const guard = new JwtAuthGuard(reflector as Reflector);

    expect(guard.canActivate(createContext())).toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('delegates to passport auth guard for protected routes', () => {
    const reflector: Pick<Reflector, 'getAllAndOverride'> = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };

    const superSpy = jest
      .spyOn(parentPrototype, 'canActivate')
      .mockReturnValue(true);
    const guard = new JwtAuthGuard(reflector as Reflector);

    expect(guard.canActivate(createContext())).toBe(true);
    expect(superSpy).toHaveBeenCalledTimes(1);
  });
});
