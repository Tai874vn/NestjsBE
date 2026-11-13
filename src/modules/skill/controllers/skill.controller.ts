import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SkillService } from '../services/skill.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { ExtractSkillsDto, SearchSkillsDto } from '../dto/skill.dto';

@Controller('skill')
@UseGuards(JwtAuthGuard)
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Public()
  @Get()
  findAll() {
    return this.skillService.findAll();
  }

  @Public()
  @Get('search')
  search(@Query() query: SearchSkillsDto) {
    return this.skillService.search(query.q, query.field, query.limit);
  }

  @Public()
  @Get('fields-of-study')
  fieldsOfStudy() {
    return this.skillService.fieldsOfStudy();
  }

  /** Signed-in users only: CV text is personal data. */
  @Post('extract')
  extract(@Body() dto: ExtractSkillsDto) {
    return this.skillService.extract(dto.text);
  }
}
