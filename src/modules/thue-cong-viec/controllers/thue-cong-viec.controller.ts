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

@Controller('thue-cong-viec')
@UseGuards(JwtAuthGuard)
export class ThueCongViecController {
  constructor(private readonly thueCongViecService: ThueCongViecService) {}

  @Post()
  create(@Body() createDto: CreateThueCongViecDto) {
    return this.thueCongViecService.create(createDto);
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

  @Public()
  @Get('lay-danh-sach-da-thue')
  findHiredJobs() {
    return this.thueCongViecService.findHiredJobs();
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
  ) {
    return this.thueCongViecService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.thueCongViecService.remove(id);
  }

  @Post('hoan-thanh-cong-viec/:MaThueCongViec')
  completeJob(@Param('MaThueCongViec', ParseIntPipe) id: number) {
    return this.thueCongViecService.completeJob(id);
  }
}
