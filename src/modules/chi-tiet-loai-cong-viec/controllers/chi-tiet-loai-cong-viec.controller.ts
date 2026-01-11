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
import { ChiTietLoaiCongViecService } from '../services/chi-tiet-loai-cong-viec.service';
import { CreateChiTietLoaiCongViecDto } from '../dto/create-chi-tiet-loai-cong-viec.dto';
import { UpdateChiTietLoaiCongViecDto } from '../dto/update-chi-tiet-loai-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('chi-tiet-loai-cong-viec')
@UseGuards(JwtAuthGuard)
export class ChiTietLoaiCongViecController {
  constructor(
    private readonly chiTietLoaiCongViecService: ChiTietLoaiCongViecService,
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
      storage: diskStorage({
        destination: './uploads/chi-tiet-loai-cong-viec',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `chi-tiet-${uniqueSuffix}${extname(file.originalname)}`);
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
    @Param('MaNhomLoaiCongViec', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.chiTietLoaiCongViecService.uploadImage(id, file.filename);
  }

  @Put('sua-nhom-chi-tiet-loai/:id')
  updateGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateChiTietLoaiCongViecDto,
  ) {
    return this.chiTietLoaiCongViecService.update(id, updateDto);
  }
}
