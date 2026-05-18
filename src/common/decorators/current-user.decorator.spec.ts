import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';

describe('CurrentUser decorator', () => {
  it('returns user from request context', () => {
    class TestController {
      test(@CurrentUser() user: unknown) {
        void user;
      }
    }

    const argsMetadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      TestController,
      'test',
    ) as Record<
      string,
      { factory: (data: unknown, ctx: ExecutionContext) => unknown }
    >;
    const [firstMetadataKey] = Object.keys(argsMetadata);

    const user = { id: 10, email: 'user@example.com' };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as ExecutionContext;

    expect(argsMetadata[firstMetadataKey].factory(undefined, context)).toBe(
      user,
    );
  });
});
