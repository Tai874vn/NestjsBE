import { ROLES_KEY, Role } from '../../common/constants/roles';
import { RedisController } from './redis.controller';

describe('RedisController authorization metadata', () => {
  it('requires the admin role for every cache-management endpoint', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RedisController)).toEqual([Role.ADMIN]);
  });
});
