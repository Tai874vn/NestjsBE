import 'reflect-metadata';
import { ROLES_KEY, Role } from '../../../common/constants/roles';
import { UsersController } from './users.controller';

describe('UsersController candidate directory', () => {
  it('limits candidate directory access to employers and admins', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      UsersController.prototype.findCandidates,
    );

    expect(roles).toEqual([Role.EMPLOYER, Role.ADMIN]);
  });
});
