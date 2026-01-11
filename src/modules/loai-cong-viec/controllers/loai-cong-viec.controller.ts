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
import { LoaiCongViecService } from '../services/loai-cong-viec.service';
import { CreateLoaiCongViecDto } from '../dto/create-loai-cong-viec.dto';
import { UpdateLoaiCongViecDto } from '../dto/update-loai-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';

@Controller('loai-cong-viec')
@UseGuards(JwtAuthGuard)
export class LoaiCongViecController {
  constructor(private readonly loaiCongViecService: LoaiCongViecService) {}

  @Post()
  create(@Body() createDto: CreateLoaiCongViecDto) {
    return this.loaiCongViecService.create(createDto);
  }

  @Public()
  @Get()
  findAll() {
    return this.loaiCongViecService.findAll();
  }

  @Public()
  @Get('phan-trang-tim-kiem')
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.loaiCongViecService.findAllWithPagination(paginationDto);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.loaiCongViecService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateLoaiCongViecDto,
  ) {
    return this.loaiCongViecService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.loaiCongViecService.remove(id);
  }
}
