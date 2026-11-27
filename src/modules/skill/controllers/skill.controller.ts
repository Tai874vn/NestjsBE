/**
 * HTTP controller for the skill module. Routes: GET /api/skill -> findAll(), GET /api/skill/search -> search(), GET /api/skill/fields-of-study -> fieldsOfStudy(), POST /api/skill/extract -> extract().
 *
 * Calls: SkillService; JwtAuthGuard; Public; PUBLIC_TAXONOMY_CACHE_CONTROL; SearchSkillsDto; ExtractSkillsDto
 * Used by:
 *   - src/modules/skill/skill.module.ts
 */

import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkillService } from '../services/skill.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { PUBLIC_TAXONOMY_CACHE_CONTROL } from '../../../common/middleware/cache-control.middleware';
import { ExtractSkillsDto, SearchSkillsDto } from '../dto/skill.dto';

@Controller('skill')
@UseGuards(JwtAuthGuard)
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Public()
  @Get()
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  findAll() {
    return this.skillService.findAll();
  }

  @Public()
  @Get('search')
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  search(@Query() query: SearchSkillsDto) {
    return this.skillService.search(query.q, query.field, query.limit);
  }

  @Public()
  @Get('fields-of-study')
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  fieldsOfStudy() {
    return this.skillService.fieldsOfStudy();
  }

  /** Signed-in users only: CV text is personal data. */
  @Post('extract')
  extract(@Body() dto: ExtractSkillsDto) {
    return this.skillService.extract(dto.text);
  }
}
