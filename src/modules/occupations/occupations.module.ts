/**
 * NestJS module for the occupations feature.
 * It registers OccupationsController and OccupationsService, and exports OccupationsService.
 *
 * Calls: OccupationsController; OccupationsService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { OccupationsController } from './controllers/occupations.controller';
import { OccupationsService } from './services/occupations.service';

@Module({
  controllers: [OccupationsController],
  providers: [OccupationsService],
  exports: [OccupationsService],
})
export class OccupationsModule {}
