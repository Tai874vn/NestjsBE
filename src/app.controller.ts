/**
 * Root App module controller for basic API greeting and health checks.
 * Routes: GET /api -> getHello(); GET /api/health/live -> getLiveness(); GET /api/health/ready -> getReadiness().
 *
 * Calls: AppService; Public
 * Used by:
 *   - src/app.module.ts
 */

import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health/live')
  getLiveness() {
    return { status: 'ok' };
  }

  @Public()
  @Get('health/ready')
  getReadiness() {
    return this.appService.getReadiness();
  }
}
