import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkillService } from '../services/skill.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';

@Controller('skill')
@UseGuards(JwtAuthGuard)
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Public()
  @Get()
  findAll() {
    return this.skillService.findAll();
  }
}
