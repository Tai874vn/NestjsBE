/**
 * Common global rate-limit guard that applies NestJS throttling to HTTP requests only.
 * Skips non-HTTP contexts such as WebSocket gateways so Socket.IO connections are not throttled here.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/app.module.ts
 */

import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    return super.canActivate(context);
  }
}
