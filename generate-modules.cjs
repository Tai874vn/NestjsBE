const fs = require('fs');
const path = require('path');

// Helper function to ensure directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Helper function to write file
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Created: ${filePath}`);
}

const srcPath = path.join(__dirname, 'src');

// ===========================
// 1. ChiTietLoaiCongViec Module
// ===========================

const chiTietPath = path.join(srcPath, 'chi-tiet-loai-cong-viec');

// DTOs
writeFile(path.join(chiTietPath, 'dto', 'create-chi-tiet-loai-cong-viec.dto.ts'), `import { IsNotEmpty, IsString, IsInt, IsOptional } from 'class-validator';

export class CreateChiTietLoaiCongViecDto {
  @IsNotEmpty()
  @IsString()
  tenChiTiet: string;

  @IsOptional()
  @IsString()
  hinhAnh?: string;

  @IsNotEmpty()
  @IsInt()
  maLoaiCongViec: number;
}
`);

writeFile(path.join(chiTietPath, 'dto', 'update-chi-tiet-loai-cong-viec.dto.ts'), `import { PartialType } from '@nestjs/mapped-types';
import { CreateChiTietLoaiCongViecDto } from './create-chi-tiet-loai-cong-viec.dto';

export class UpdateChiTietLoaiCongViecDto extends PartialType(CreateChiTietLoaiCongViecDto) {}
`);

// Service
writeFile(path.join(chiTietPath, 'services', 'chi-tiet-loai-cong-viec.service.ts'), `import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateChiTietLoaiCongViecDto } from '../dto/create-chi-tiet-loai-cong-viec.dto';
import { UpdateChiTietLoaiCongViecDto } from '../dto/update-chi-tiet-loai-cong-viec.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class ChiTietLoaiCongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateChiTietLoaiCongViecDto) {
    const chiTietLoaiCongViec = await this.prisma.chiTietLoaiCongViec.create({
      data: createDto,
      include: {
        loaiCongViec: true,
      },
    });

    return {
      message: 'Job detail type created successfully',
      content: chiTietLoaiCongViec,
    };
  }

  async findAll() {
    const chiTietLoaiCongViecs = await this.prisma.chiTietLoaiCongViec.findMany({
      include: {
        loaiCongViec: true,
        congViecs: true,
      },
    });

    return {
      message: 'Get job detail types successfully',
      content: chiTietLoaiCongViecs,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          tenChiTiet: { contains: keyword, mode: 'insensitive' },
        }
      : {};

    const [chiTietLoaiCongViecs, total] = await Promise.all([
      this.prisma.chiTietLoaiCongViec.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          loaiCongViec: true,
          congViecs: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.chiTietLoaiCongViec.count({ where }),
    ]);

    return {
      message: 'Get job detail types with pagination successfully',
      content: {
        data: chiTietLoaiCongViecs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const chiTietLoaiCongViec = await this.prisma.chiTietLoaiCongViec.findUnique({
      where: { id },
      include: {
        loaiCongViec: true,
        congViecs: true,
      },
    });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(\`Job detail type with ID \${id} not found\`);
    }

    return {
      message: 'Get job detail type successfully',
      content: chiTietLoaiCongViec,
    };
  }

  async update(id: number, updateDto: UpdateChiTietLoaiCongViecDto) {
    const chiTietLoaiCongViec = await this.prisma.chiTietLoaiCongViec.findUnique({
      where: { id },
    });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(\`Job detail type with ID \${id} not found\`);
    }

    const updated = await this.prisma.chiTietLoaiCongViec.update({
      where: { id },
      data: updateDto,
      include: {
        loaiCongViec: true,
        congViecs: true,
      },
    });

    return {
      message: 'Job detail type updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const chiTietLoaiCongViec = await this.prisma.chiTietLoaiCongViec.findUnique({
      where: { id },
    });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(\`Job detail type with ID \${id} not found\`);
    }

    await this.prisma.chiTietLoaiCongViec.delete({
      where: { id },
    });

    return {
      message: 'Job detail type deleted successfully',
    };
  }

  async uploadImage(id: number, filename: string) {
    const chiTietLoaiCongViec = await this.prisma.chiTietLoaiCongViec.findUnique({
      where: { id },
    });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(\`Job detail type with ID \${id} not found\`);
    }

    const updated = await this.prisma.chiTietLoaiCongViec.update({
      where: { id },
      data: { hinhAnh: filename },
    });

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }
}
`);

// Controller
writeFile(path.join(chiTietPath, 'controllers', 'chi-tiet-loai-cong-viec.controller.ts'), `import {
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
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('chi-tiet-loai-cong-viec')
@UseGuards(JwtAuthGuard)
export class ChiTietLoaiCongViecController {
  constructor(private readonly chiTietLoaiCongViecService: ChiTietLoaiCongViecService) {}

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
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, \`chi-tiet-\${uniqueSuffix}\${extname(file.originalname)}\`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\\/(jpg|jpeg|png|gif)$/)) {
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
`);

// Module
writeFile(path.join(chiTietPath, 'chi-tiet-loai-cong-viec.module.ts'), `import { Module } from '@nestjs/common';
import { ChiTietLoaiCongViecService } from './services/chi-tiet-loai-cong-viec.service';
import { ChiTietLoaiCongViecController } from './controllers/chi-tiet-loai-cong-viec.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ChiTietLoaiCongViecController],
  providers: [ChiTietLoaiCongViecService, PrismaService],
  exports: [ChiTietLoaiCongViecService],
})
export class ChiTietLoaiCongViecModule {}
`);

// ===========================
// 2. CongViec Module
// ===========================

const congViecPath = path.join(srcPath, 'cong-viec');

// DTOs
writeFile(path.join(congViecPath, 'dto', 'create-cong-viec.dto.ts'), `import { IsNotEmpty, IsString, IsInt, IsOptional, Min } from 'class-validator';

export class CreateCongViecDto {
  @IsNotEmpty()
  @IsString()
  tenCongViec: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  danhGia?: number;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  giaTien: number;

  @IsOptional()
  @IsString()
  hinhAnh?: string;

  @IsOptional()
  @IsString()
  moTa?: string;

  @IsOptional()
  @IsString()
  moTaNgan?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  saoCongViec?: number;

  @IsNotEmpty()
  @IsInt()
  maChiTietLoai: number;

  @IsOptional()
  @IsInt()
  nguoiTao?: number;
}
`);

writeFile(path.join(congViecPath, 'dto', 'update-cong-viec.dto.ts'), `import { PartialType } from '@nestjs/mapped-types';
import { CreateCongViecDto } from './create-cong-viec.dto';

export class UpdateCongViecDto extends PartialType(CreateCongViecDto) {}
`);

// Service
writeFile(path.join(congViecPath, 'services', 'cong-viec.service.ts'), `import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateCongViecDto } from '../dto/create-cong-viec.dto';
import { UpdateCongViecDto } from '../dto/update-cong-viec.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class CongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateCongViecDto) {
    const congViec = await this.prisma.congViec.create({
      data: createDto,
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
      },
    });

    return {
      message: 'Job created successfully',
      content: congViec,
    };
  }

  async findAll() {
    const congViecs = await this.prisma.congViec.findMany({
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
      },
    });

    return {
      message: 'Get jobs successfully',
      content: congViecs,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          tenCongViec: { contains: keyword, mode: 'insensitive' },
        }
      : {};

    const [congViecs, total] = await Promise.all([
      this.prisma.congViec.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          chiTietLoaiCongViec: {
            include: {
              loaiCongViec: true,
            },
          },
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.congViec.count({ where }),
    ]);

    return {
      message: 'Get jobs with pagination successfully',
      content: {
        data: congViecs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
        binhLuans: {
          include: {
            nguoiDung: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!congViec) {
      throw new NotFoundException(\`Job with ID \${id} not found\`);
    }

    return {
      message: 'Get job successfully',
      content: congViec,
    };
  }

  async update(id: number, updateDto: UpdateCongViecDto) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(\`Job with ID \${id} not found\`);
    }

    const updated = await this.prisma.congViec.update({
      where: { id },
      data: updateDto,
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
      },
    });

    return {
      message: 'Job updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(\`Job with ID \${id} not found\`);
    }

    await this.prisma.congViec.delete({
      where: { id },
    });

    return {
      message: 'Job deleted successfully',
    };
  }

  async uploadImage(id: number, filename: string) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(\`Job with ID \${id} not found\`);
    }

    const updated = await this.prisma.congViec.update({
      where: { id },
      data: { hinhAnh: filename },
    });

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }

  async getMenuLoaiCongViec() {
    const loaiCongViecs = await this.prisma.loaiCongViec.findMany({
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    return {
      message: 'Get menu job types successfully',
      content: loaiCongViecs,
    };
  }

  async getChiTietLoaiCongViec(maLoaiCongViec: number) {
    const chiTietLoaiCongViecs = await this.prisma.chiTietLoaiCongViec.findMany({
      where: { maLoaiCongViec },
      include: {
        loaiCongViec: true,
        congViecs: true,
      },
    });

    return {
      message: 'Get job detail types successfully',
      content: chiTietLoaiCongViecs,
    };
  }

  async getCongViecByChiTietLoai(maChiTietLoai: number) {
    const congViecs = await this.prisma.congViec.findMany({
      where: { maChiTietLoai },
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
      },
    });

    return {
      message: 'Get jobs by detail type successfully',
      content: congViecs,
    };
  }

  async getCongViecChiTiet(maCongViec: number) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id: maCongViec },
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
        binhLuans: {
          include: {
            nguoiDung: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
          orderBy: {
            ngayBinhLuan: 'desc',
          },
        },
      },
    });

    if (!congViec) {
      throw new NotFoundException(\`Job with ID \${maCongViec} not found\`);
    }

    return {
      message: 'Get job detail successfully',
      content: congViec,
    };
  }

  async searchByName(tenCongViec: string) {
    const congViecs = await this.prisma.congViec.findMany({
      where: {
        tenCongViec: {
          contains: tenCongViec,
          mode: 'insensitive',
        },
      },
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
      },
    });

    return {
      message: 'Search jobs successfully',
      content: congViecs,
    };
  }
}
`);

// Controller
writeFile(path.join(congViecPath, 'controllers', 'cong-viec.controller.ts'), `import {
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
          cb(null, \`cong-viec-\${uniqueSuffix}\${extname(file.originalname)}\`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\\/(jpg|jpeg|png|gif)$/)) {
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
`);

// Module
writeFile(path.join(congViecPath, 'cong-viec.module.ts'), `import { Module } from '@nestjs/common';
import { CongViecService } from './services/cong-viec.service';
import { CongViecController } from './controllers/cong-viec.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [CongViecController],
  providers: [CongViecService, PrismaService],
  exports: [CongViecService],
})
export class CongViecModule {}
`);

// ===========================
// 3. BinhLuan Module
// ===========================

const binhLuanPath = path.join(srcPath, 'binh-luan');

// DTOs
writeFile(path.join(binhLuanPath, 'dto', 'create-binh-luan.dto.ts'), `import { IsNotEmpty, IsString, IsInt, Min, Max } from 'class-validator';

export class CreateBinhLuanDto {
  @IsNotEmpty()
  @IsInt()
  maCongViec: number;

  @IsNotEmpty()
  @IsInt()
  maNguoiBinhLuan: number;

  @IsNotEmpty()
  @IsString()
  noiDung: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  saoBinhLuan: number;
}
`);

writeFile(path.join(binhLuanPath, 'dto', 'update-binh-luan.dto.ts'), `import { PartialType } from '@nestjs/mapped-types';
import { CreateBinhLuanDto } from './create-binh-luan.dto';

export class UpdateBinhLuanDto extends PartialType(CreateBinhLuanDto) {}
`);

// Service
writeFile(path.join(binhLuanPath, 'services', 'binh-luan.service.ts'), `import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateBinhLuanDto } from '../dto/create-binh-luan.dto';
import { UpdateBinhLuanDto } from '../dto/update-binh-luan.dto';

@Injectable()
export class BinhLuanService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateBinhLuanDto) {
    const binhLuan = await this.prisma.binhLuan.create({
      data: createDto,
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Comment created successfully',
      content: binhLuan,
    };
  }

  async findAll() {
    const binhLuans = await this.prisma.binhLuan.findMany({
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        ngayBinhLuan: 'desc',
      },
    });

    return {
      message: 'Get comments successfully',
      content: binhLuans,
    };
  }

  async findOne(id: number) {
    const binhLuan = await this.prisma.binhLuan.findUnique({
      where: { id },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    if (!binhLuan) {
      throw new NotFoundException(\`Comment with ID \${id} not found\`);
    }

    return {
      message: 'Get comment successfully',
      content: binhLuan,
    };
  }

  async update(id: number, updateDto: UpdateBinhLuanDto) {
    const binhLuan = await this.prisma.binhLuan.findUnique({
      where: { id },
    });

    if (!binhLuan) {
      throw new NotFoundException(\`Comment with ID \${id} not found\`);
    }

    const updated = await this.prisma.binhLuan.update({
      where: { id },
      data: updateDto,
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Comment updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const binhLuan = await this.prisma.binhLuan.findUnique({
      where: { id },
    });

    if (!binhLuan) {
      throw new NotFoundException(\`Comment with ID \${id} not found\`);
    }

    await this.prisma.binhLuan.delete({
      where: { id },
    });

    return {
      message: 'Comment deleted successfully',
    };
  }

  async findByJob(maCongViec: number) {
    const binhLuans = await this.prisma.binhLuan.findMany({
      where: { maCongViec },
      include: {
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        ngayBinhLuan: 'desc',
      },
    });

    return {
      message: 'Get comments by job successfully',
      content: binhLuans,
    };
  }
}
`);

// Controller
writeFile(path.join(binhLuanPath, 'controllers', 'binh-luan.controller.ts'), `import {
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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('binh-luan')
@UseGuards(JwtAuthGuard)
export class BinhLuanController {
  constructor(private readonly binhLuanService: BinhLuanService) {}

  @Post()
  create(@Body() createDto: CreateBinhLuanDto) {
    return this.binhLuanService.create(createDto);
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
  ) {
    return this.binhLuanService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.binhLuanService.remove(id);
  }
}
`);

// Module
writeFile(path.join(binhLuanPath, 'binh-luan.module.ts'), `import { Module } from '@nestjs/common';
import { BinhLuanService } from './services/binh-luan.service';
import { BinhLuanController } from './controllers/binh-luan.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [BinhLuanController],
  providers: [BinhLuanService, PrismaService],
  exports: [BinhLuanService],
})
export class BinhLuanModule {}
`);

// ===========================
// 4. ThueCongViec Module
// ===========================

const thueCongViecPath = path.join(srcPath, 'thue-cong-viec');

// DTOs
writeFile(path.join(thueCongViecPath, 'dto', 'create-thue-cong-viec.dto.ts'), `import { IsNotEmpty, IsInt, IsOptional, IsBoolean } from 'class-validator';

export class CreateThueCongViecDto {
  @IsNotEmpty()
  @IsInt()
  maCongViec: number;

  @IsNotEmpty()
  @IsInt()
  maNguoiThue: number;

  @IsOptional()
  @IsBoolean()
  hoanThanh?: boolean;
}
`);

writeFile(path.join(thueCongViecPath, 'dto', 'update-thue-cong-viec.dto.ts'), `import { PartialType } from '@nestjs/mapped-types';
import { CreateThueCongViecDto } from './create-thue-cong-viec.dto';

export class UpdateThueCongViecDto extends PartialType(CreateThueCongViecDto) {}
`);

// Service
writeFile(path.join(thueCongViecPath, 'services', 'thue-cong-viec.service.ts'), `import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateThueCongViecDto } from '../dto/create-thue-cong-viec.dto';
import { UpdateThueCongViecDto } from '../dto/update-thue-cong-viec.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class ThueCongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateThueCongViecDto) {
    const thueCongViec = await this.prisma.thueCongViec.create({
      data: createDto,
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Job hired successfully',
      content: thueCongViec,
    };
  }

  async findAll() {
    const thueCongViecs = await this.prisma.thueCongViec.findMany({
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        ngayThue: 'desc',
      },
    });

    return {
      message: 'Get hired jobs successfully',
      content: thueCongViecs,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10 } = paginationDto;
    const skip = (page - 1) * pageSize;

    const [thueCongViecs, total] = await Promise.all([
      this.prisma.thueCongViec.findMany({
        skip,
        take: pageSize,
        include: {
          congViec: true,
          nguoiDung: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
        orderBy: {
          ngayThue: 'desc',
        },
      }),
      this.prisma.thueCongViec.count(),
    ]);

    return {
      message: 'Get hired jobs with pagination successfully',
      content: {
        data: thueCongViecs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    if (!thueCongViec) {
      throw new NotFoundException(\`Hired job with ID \${id} not found\`);
    }

    return {
      message: 'Get hired job successfully',
      content: thueCongViec,
    };
  }

  async update(id: number, updateDto: UpdateThueCongViecDto) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
    });

    if (!thueCongViec) {
      throw new NotFoundException(\`Hired job with ID \${id} not found\`);
    }

    const updated = await this.prisma.thueCongViec.update({
      where: { id },
      data: updateDto,
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Hired job updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
    });

    if (!thueCongViec) {
      throw new NotFoundException(\`Hired job with ID \${id} not found\`);
    }

    await this.prisma.thueCongViec.delete({
      where: { id },
    });

    return {
      message: 'Hired job deleted successfully',
    };
  }

  async findHiredJobs() {
    const thueCongViecs = await this.prisma.thueCongViec.findMany({
      where: {
        hoanThanh: false,
      },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        ngayThue: 'desc',
      },
    });

    return {
      message: 'Get hired jobs list successfully',
      content: thueCongViecs,
    };
  }

  async completeJob(id: number) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
    });

    if (!thueCongViec) {
      throw new NotFoundException(\`Hired job with ID \${id} not found\`);
    }

    const updated = await this.prisma.thueCongViec.update({
      where: { id },
      data: { hoanThanh: true },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Job completed successfully',
      content: updated,
    };
  }
}
`);

// Controller
writeFile(path.join(thueCongViecPath, 'controllers', 'thue-cong-viec.controller.ts'), `import {
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
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

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
`);

// Module
writeFile(path.join(thueCongViecPath, 'thue-cong-viec.module.ts'), `import { Module } from '@nestjs/common';
import { ThueCongViecService } from './services/thue-cong-viec.service';
import { ThueCongViecController } from './controllers/thue-cong-viec.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [ThueCongViecController],
  providers: [ThueCongViecService, PrismaService],
  exports: [ThueCongViecService],
})
export class ThueCongViecModule {}
`);

// ===========================
// 5. Skill Module
// ===========================

const skillPath = path.join(srcPath, 'skill');

// Service
writeFile(path.join(skillPath, 'services', 'skill.service.ts'), `import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class SkillService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const users = await this.prisma.nguoiDung.findMany({
      select: {
        id: true,
        name: true,
        skill: true,
      },
      where: {
        skill: {
          not: null,
        },
      },
    });

    const skills = users
      .filter(user => user.skill)
      .flatMap(user => {
        try {
          const parsedSkills = JSON.parse(user.skill || '[]');
          return Array.isArray(parsedSkills) ? parsedSkills : [];
        } catch {
          return [];
        }
      })
      .filter((skill, index, self) => self.indexOf(skill) === index);

    return {
      message: 'Get skills successfully',
      content: skills,
    };
  }
}
`);

// Controller
writeFile(path.join(skillPath, 'controllers', 'skill.controller.ts'), `import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkillService } from '../services/skill.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('skill')
@UseGuards(JwtAuthGuard)
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Public()
  @Get()
  findAll() {
    return this.skillService.findAll();
  }
}
`);

// Module
writeFile(path.join(skillPath, 'skill.module.ts'), `import { Module } from '@nestjs/common';
import { SkillService } from './services/skill.service';
import { SkillController } from './controllers/skill.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [SkillController],
  providers: [SkillService, PrismaService],
  exports: [SkillService],
})
export class SkillModule {}
`);

console.log('\n\nAll module files created successfully!');
console.log('\nNext steps:');
console.log('1. Create upload directories:');
console.log('   mkdir -p uploads/chi-tiet-loai-cong-viec uploads/cong-viec');
console.log('2. Update app.module.ts to import these modules');
console.log('3. Run the application with: npm run start:dev');
