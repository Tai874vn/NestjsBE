import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { HiresService } from '../services/hires.service';
import { CreateHireDto } from '../dto/create-hire.dto';
import { UpdateHireDto } from '../dto/update-hire.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';

@Controller('hires')
@UseGuards(JwtAuthGuard)
export class HiresController {
  constructor(private readonly hiresService: HiresService) {}

  @Post()
  create(
    @Body() createDto: CreateHireDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiresService.create(createDto, user.id);
  }

  @Get()
  findAll() {
    return this.hiresService.findAll();
  }

  @Get('paginated-search')
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.hiresService.findAllWithPagination(paginationDto);
  }

  @Get('my-hires')
  findHiredJobs(@CurrentUser() user: ValidatedUser) {
    return this.hiresService.findHiredJobs(user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hiresService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateHireDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiresService.update(id, updateDto, user.id, user.role);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiresService.remove(id, user.id, user.role);
  }

  @Post('complete/:hireId')
  completeJob(
    @Param('hireId', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiresService.completeJob(id, user.id, user.role);
  }
}
