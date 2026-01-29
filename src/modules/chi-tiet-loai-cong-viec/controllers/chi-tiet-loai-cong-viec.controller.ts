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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ChiTietLoaiCongViecService } from '../services/chi-tiet-loai-cong-viec.service';
import { CreateChiTietLoaiCongViecDto } from '../dto/create-chi-tiet-loai-cong-viec.dto';
import { UpdateChiTietLoaiCongViecDto } from '../dto/update-chi-tiet-loai-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

@Controller('chi-tiet-loai-cong-viec')
@UseGuards(JwtAuthGuard)
export class ChiTietLoaiCongViecController {
  constructor(
    private readonly chiTietLoaiCongViecService: ChiTietLoaiCongViecService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post()
  create(@Body() createDto: CreateChiTietLoaiCongViecDto) {
    return this.chiTietLoaiCongViecService.create(createDto);
  }

  @Public()
  @Get()
  findAll() {
    return this.chiTietLoaiCongViecService.findAll();
  }

  @Public()
  @Get('phan-trang-tim-kiem')
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.chiTietLoaiCongViecService.findAllWithPagination(paginationDto);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.chiTietLoaiCongViecService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateChiTietLoaiCongViecDto,
  ) {
    return this.chiTietLoaiCongViecService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.chiTietLoaiCongViecService.remove(id);
  }

  @Post('them-nhom-chi-tiet-loai')
  createGroup(@Body() createDto: CreateChiTietLoaiCongViecDto) {
    return this.chiTietLoaiCongViecService.create(createDto);
  }

  @Post('upload-hinh-nhom-loai-cong-viec/:MaNhomLoaiCongViec')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    }),
  )
  async uploadImage(
    @Param('MaNhomLoaiCongViec', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.cloudinaryService.uploadImage(
      file,
      'chi-tiet-loai-cong-viec',
    );
    return this.chiTietLoaiCongViecService.uploadImage(id, result.secure_url);
  }

  @Put('sua-nhom-chi-tiet-loai/:id')
  updateGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateChiTietLoaiCongViecDto,
  ) {
    return this.chiTietLoaiCongViecService.update(id, updateDto);
  }
}
