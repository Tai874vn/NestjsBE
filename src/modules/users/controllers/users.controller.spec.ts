import 'reflect-metadata';
import { ROLES_KEY, Role } from '../../../common/constants/roles';
import { UsersController } from './users.controller';

describe('UsersController candidate directory', () => {
  it('limits candidate directory access to employers and admins', () => {
    const handler = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'findCandidates',
    )?.value;
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      handler,
    );

    expect(roles).toEqual([Role.EMPLOYER, Role.ADMIN]);
  });
});
