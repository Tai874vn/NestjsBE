import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { OccupationsService } from './occupations.service';
import { SearchOccupationsDto } from './dto/search-occupations.dto';

@Controller('occupations')
@UseGuards(JwtAuthGuard)
export class OccupationsController {
  constructor(private readonly occupations: OccupationsService) {}

  @Public()
  @Get()
  search(@Query() query: SearchOccupationsDto) {
    return this.occupations.search(query.q ?? '', query.limit);
  }

  @Public()
  @Get(':code')
  findOne(@Param('code') code: string) {
    return this.occupations.occupation(code);
  }
}
