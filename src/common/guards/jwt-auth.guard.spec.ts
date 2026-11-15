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
      getType: jest.fn().mockReturnValue('http'),
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

  it('leaves websocket authentication to the gateway middleware', () => {
    const reflector: Pick<Reflector, 'getAllAndOverride'> = {
      getAllAndOverride: jest.fn(),
    };
    const superSpy = jest.spyOn(parentPrototype, 'canActivate').mockReturnValue(false);
    const guard = new JwtAuthGuard(reflector as Reflector);
    const context = {
      getType: jest.fn().mockReturnValue('ws'),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
  });

  describe('optional authentication', () => {
    const optional = (value: boolean) =>
      ({
        getAllAndOverride: jest
          .fn()
          .mockImplementation((key: string) =>
            key === 'optionalAuth' ? value : false,
          ),
      }) as unknown as Reflector;

    it('lets a visitor without a token through as anonymous', () => {
      const guard = new JwtAuthGuard(optional(true));
      expect(
        guard.handleRequest(null, false, { message: 'No auth token' }, createContext()),
      ).toBeNull();
    });

    it('still rejects an expired token so the client refreshes it', () => {
      const guard = new JwtAuthGuard(optional(true));
      expect(() =>
        guard.handleRequest(null, false, { name: 'TokenExpiredError' }, createContext()),
      ).toThrow('Access token is missing, invalid or expired');
    });

    it('requires a token on routes that are not optional', () => {
      const guard = new JwtAuthGuard(optional(false));
      expect(() =>
        guard.handleRequest(null, false, { message: 'No auth token' }, createContext()),
      ).toThrow('Access token is missing, invalid or expired');
    });
  });
});
