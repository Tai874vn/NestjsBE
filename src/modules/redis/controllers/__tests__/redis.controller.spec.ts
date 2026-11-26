import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY, Role } from '../../../../common/constants/roles';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { RedisController } from '../redis.controller';

describe('RedisController routing and authorization metadata', () => {
  it('registers under "cache" (not double-prefixed "api/cache")', () => {
    expect(Reflect.getMetadata(PATH_METADATA, RedisController)).toBe('cache');
  });

  it('requires the admin role for every cache-management endpoint and marks none public', () => {
    expect(Reflect.getMetadata(ROLES_KEY, RedisController)).toEqual([
      Role.ADMIN,
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, RedisController)).toBeUndefined();

    const methods = Object.getOwnPropertyNames(
      RedisController.prototype,
    ).filter((name) => name !== 'constructor');
    for (const method of methods) {
      const handler = (
        RedisController.prototype as unknown as Record<string, object>
      )[method];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    }
  });
});
