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
import { CongViecService } from '../services/cong-viec.service';
import { CreateCongViecDto } from '../dto/create-cong-viec.dto';
import { UpdateCongViecDto } from '../dto/update-cong-viec.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('cong-viec')
@UseGuards(JwtAuthGuard)
export class CongViecController {
  constructor(private readonly congViecService: CongViecService) {}

  @Post()
  create(@Body() createDto: CreateCongViecDto) {
    return this.congViecService.create(createDto);
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
  ) {
    return this.congViecService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.congViecService.remove(id);
  }

  @Post('upload-hinh-cong-viec/:MaCongViec')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/cong-viec',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `cong-viec-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
          return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(
    @Param('MaCongViec', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.congViecService.uploadImage(id, file.filename);
  }
}
