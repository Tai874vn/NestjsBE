import 'reflect-metadata';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { Role, ROLES_KEY } from '../constants/roles';
import { Roles } from './roles.decorator';

describe('metadata decorators', () => {
  class TestController {
    @Public()
    publicRoute() {
      return 'ok';
    }

    @Roles(Role.ADMIN, Role.USER)
    adminAndUserRoute() {
      return 'ok';
    }
  }

  it('sets public metadata flag', () => {
    const publicRoute = Object.getOwnPropertyDescriptor(
      TestController.prototype,
      'publicRoute',
    )?.value as object | undefined;
    expect(publicRoute).toBeDefined();
    if (!publicRoute) {
      return;
    }

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, publicRoute)).toBe(true);
  });

  it('sets roles metadata', () => {
    const adminAndUserRoute = Object.getOwnPropertyDescriptor(
      TestController.prototype,
      'adminAndUserRoute',
    )?.value as object | undefined;
    expect(adminAndUserRoute).toBeDefined();
    if (!adminAndUserRoute) {
      return;
    }

    expect(Reflect.getMetadata(ROLES_KEY, adminAndUserRoute)).toEqual([
      Role.ADMIN,
      Role.USER,
    ]);
  });
});
