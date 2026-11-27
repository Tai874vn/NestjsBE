/**
 * Common auth metadata decorators `@Public()` and `@OptionalAuth()`, along with their metadata keys.
 * Marks routes that skip JWT authentication or accept anonymous visitors while still identifying signed-in users.
 *
 * Calls: nothing from this project
 * Used by:
 *   - 11 files, for example src/app.controller.ts, src/modules/auth/controllers/auth.controller.ts, src/modules/categories/controllers/categories.controller.ts
 */

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'optionalAuth';
/** Open to visitors; when a valid access token is sent, the route still sees the signed-in user. */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
