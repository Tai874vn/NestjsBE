/**
 * Occupations module controller for public ESCO occupation lookups with cache headers.
 * Routes: GET /api/occupations -> search(), GET /api/occupations/:code -> findOne().
 *
 * Calls: OccupationsService; SearchOccupationsDto; JwtAuthGuard; Public; PUBLIC_TAXONOMY_CACHE_CONTROL
 * Used by:
 *   - src/modules/occupations/occupations.module.ts
 */

import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { PUBLIC_TAXONOMY_CACHE_CONTROL } from '../../../common/middleware/cache-control.middleware';
import { OccupationsService } from '../services/occupations.service';
import { SearchOccupationsDto } from '../dto/search-occupations.dto';

@Controller('occupations')
@UseGuards(JwtAuthGuard)
export class OccupationsController {
  constructor(private readonly occupations: OccupationsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  search(@Query() query: SearchOccupationsDto) {
    return this.occupations.search(query.q ?? '', query.limit);
  }

  @Public()
  @Get(':code')
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  findOne(@Param('code') code: string) {
    return this.occupations.occupation(code);
  }
}
