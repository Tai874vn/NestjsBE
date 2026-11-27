/**
 * Global NestJS module for the Observability feature.
 * Registers and exports `ObservabilityService` so all modules can log operation timings and HTTP metrics.
 *
 * Calls: ObservabilityService
 * Used by:
 *   - src/app.module.ts
 *   - src/modules/chat/chat.module.ts
 *   - src/modules/notifications/notifications.module.ts
 *   - src/modules/recommendations/recommendations.module.ts
 */

import { Global, Module } from '@nestjs/common';
import { ObservabilityService } from './observability.service';

@Global()
@Module({
  providers: [ObservabilityService],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
