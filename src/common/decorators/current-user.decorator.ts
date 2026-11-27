/**
 * Common parameter decorator `@CurrentUser()` that reads `request.user` from the HTTP request.
 * Lets controller handlers receive the authenticated user attached by the JWT guard.
 *
 * Calls: nothing from this project
 * Used by:
 *   - 18 files, for example src/modules/chat/controllers/chat.controller.ts, src/modules/comments/controllers/comments.controller.ts, src/modules/connections/controllers/connections.controller.ts
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
