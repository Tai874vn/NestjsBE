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
import { CongViecService } from '../services/cong-viec.service';
import { CreateCongViecDto } from '../dto/create-cong-viec.dto';
import { UpdateCongViecDto } from '../dto/update-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

@Controller('cong-viec')
@UseGuards(JwtAuthGuard)
export class CongViecController {
  constructor(
    private readonly congViecService: CongViecService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post()
  create(
    @Body() createDto: CreateCongViecDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.congViecService.create(createDto, user.id);
  }

  @Public()
  @Get()
  findAll() {
    return this.congViecService.findAll();
  }

  @Public()
  @Get('phan-trang-tim-kiem')
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.congViecService.findAllWithPagination(paginationDto);
  }

  @Public()
  @Get('lay-menu-loai-cong-viec')
  getMenuLoaiCongViec() {
    return this.congViecService.getMenuLoaiCongViec();
  }

  @Public()
  @Get('lay-chi-tiet-loai-cong-viec/:MaLoaiCongViec')
  getChiTietLoaiCongViec(@Param('MaLoaiCongViec', ParseIntPipe) id: number) {
    return this.congViecService.getChiTietLoaiCongViec(id);
  }

  @Public()
  @Get('lay-cong-viec-theo-chi-tiet-loai/:MaChiTietLoai')
  getCongViecByChiTietLoai(@Param('MaChiTietLoai', ParseIntPipe) id: number) {
    return this.congViecService.getCongViecByChiTietLoai(id);
  }

  @Public()
  @Get('lay-cong-viec-chi-tiet/:MaCongViec')
  getCongViecChiTiet(@Param('MaCongViec', ParseIntPipe) id: number) {
    return this.congViecService.getCongViecChiTiet(id);
  }

  @Public()
  @Get('lay-danh-sach-cong-viec-theo-ten/:TenCongViec')
  searchByName(@Param('TenCongViec') name: string) {
    return this.congViecService.searchByName(name);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.congViecService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateCongViecDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.congViecService.update(id, updateDto, user.id, user.role);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.congViecService.remove(id, user.id, user.role);
  }

  @Post('upload-hinh-cong-viec/:MaCongViec')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    }),
  )
  async uploadImage(
    @Param('MaCongViec', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: ValidatedUser,
  ) {
    const result = await this.cloudinaryService.uploadImage(file, 'cong-viec');
    return this.congViecService.uploadImage(
      id,
      result.secure_url,
      user.id,
      user.role,
    );
  }
}
