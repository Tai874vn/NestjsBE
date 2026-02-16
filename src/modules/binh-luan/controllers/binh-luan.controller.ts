import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { BinhLuanService } from '../services/binh-luan.service';
import { CreateBinhLuanDto } from '../dto/create-binh-luan.dto';
import { UpdateBinhLuanDto } from '../dto/update-binh-luan.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';

@Controller('binh-luan')
@UseGuards(JwtAuthGuard)
export class BinhLuanController {
  constructor(private readonly binhLuanService: BinhLuanService) {}

  @Post()
  create(
    @Body() createDto: CreateBinhLuanDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.binhLuanService.create(createDto, user.id);
  }

  @Public()
  @Get()
  findAll() {
    return this.binhLuanService.findAll();
  }

  @Public()
  @Get('lay-binh-luan-theo-cong-viec/:MaCongViec')
  findByJob(@Param('MaCongViec', ParseIntPipe) maCongViec: number) {
    return this.binhLuanService.findByJob(maCongViec);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateBinhLuanDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.binhLuanService.update(id, updateDto, user.id, user.role);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.binhLuanService.remove(id, user.id, user.role);
  }
}
