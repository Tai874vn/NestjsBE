import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'optionalAuth';
/** Open to visitors; when a valid access token is sent, the route still sees the signed-in user. */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
