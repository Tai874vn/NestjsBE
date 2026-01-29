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
import { ThueCongViecService } from '../services/thue-cong-viec.service';
import { CreateThueCongViecDto } from '../dto/create-thue-cong-viec.dto';
import { UpdateThueCongViecDto } from '../dto/update-thue-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';

@Controller('thue-cong-viec')
@UseGuards(JwtAuthGuard)
export class ThueCongViecController {
  constructor(private readonly thueCongViecService: ThueCongViecService) {}

  @Post()
  create(
    @Body() createDto: CreateThueCongViecDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.thueCongViecService.create(createDto, user.id);
  }

  @Public()
  @Get()
  findAll() {
    return this.thueCongViecService.findAll();
  }

  @Public()
  @Get('phan-trang-tim-kiem')
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.thueCongViecService.findAllWithPagination(paginationDto);
  }

  @Get('lay-danh-sach-da-thue')
  findHiredJobs(@CurrentUser() user: ValidatedUser) {
    return this.thueCongViecService.findHiredJobs(user.id);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.thueCongViecService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateThueCongViecDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.thueCongViecService.update(id, updateDto, user.id, user.role);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.thueCongViecService.remove(id, user.id, user.role);
  }

  @Post('hoan-thanh-cong-viec/:MaThueCongViec')
  completeJob(
    @Param('MaThueCongViec', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.thueCongViecService.completeJob(id, user.id, user.role);
  }
}
