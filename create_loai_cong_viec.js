const fs = require('fs');
const path = require('path');

// Create DTO files
const createDto = `import { IsNotEmpty, IsString } from 'class-validator';

export class CreateLoaiCongViecDto {
  @IsNotEmpty()
  @IsString()
  tenLoaiCongViec: string;
}
`;

const updateDto = `import { IsOptional, IsString } from 'class-validator';

export class UpdateLoaiCongViecDto {
  @IsOptional()
  @IsString()
  tenLoaiCongViec?: string;
}
`;

// Create Service
const service = `import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateLoaiCongViecDto } from '../dto/create-loai-cong-viec.dto';
import { UpdateLoaiCongViecDto } from '../dto/update-loai-cong-viec.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class LoaiCongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateLoaiCongViecDto) {
    const loaiCongViec = await this.prisma.loaiCongViec.create({
      data: createDto,
    });

    return {
      message: 'Job type created successfully',
      content: loaiCongViec,
    };
  }

  async findAll() {
    const loaiCongViecs = await this.prisma.loaiCongViec.findMany({
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    return {
      message: 'Get job types successfully',
      content: loaiCongViecs,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          tenLoaiCongViec: { contains: keyword, mode: 'insensitive' as const },
        }
      : {};

    const [loaiCongViecs, total] = await Promise.all([
      this.prisma.loaiCongViec.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          chiTietLoaiCongViecs: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.loaiCongViec.count({ where }),
    ]);

    return {
      message: 'Get job types with pagination successfully',
      content: {
        data: loaiCongViecs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const loaiCongViec = await this.prisma.loaiCongViec.findUnique({
      where: { id },
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    if (!loaiCongViec) {
      throw new NotFoundException(\`Job type with ID \${id} not found\`);
    }

    return {
      message: 'Get job type successfully',
      content: loaiCongViec,
    };
  }

  async update(id: number, updateDto: UpdateLoaiCongViecDto) {
    const loaiCongViec = await this.prisma.loaiCongViec.findUnique({
      where: { id },
    });

    if (!loaiCongViec) {
      throw new NotFoundException(\`Job type with ID \${id} not found\`);
    }

    const updated = await this.prisma.loaiCongViec.update({
      where: { id },
      data: updateDto,
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    return {
      message: 'Job type updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const loaiCongViec = await this.prisma.loaiCongViec.findUnique({
      where: { id },
    });

    if (!loaiCongViec) {
      throw new NotFoundException(\`Job type with ID \${id} not found\`);
    }

    await this.prisma.loaiCongViec.delete({
      where: { id },
    });

    return {
      message: 'Job type deleted successfully',
    };
  }
}
`;

// Create Controller
const controller = `import {
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
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

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
`;

// Create Module
const module = `import { Module } from '@nestjs/common';
import { LoaiCongViecService } from './services/loai-cong-viec.service';
import { LoaiCongViecController } from './controllers/loai-cong-viec.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [LoaiCongViecController],
  providers: [LoaiCongViecService, PrismaService],
  exports: [LoaiCongViecService],
})
export class LoaiCongViecModule {}
`;

// Write files
const basePath = path.join(__dirname, 'src', 'loai-cong-viec');
fs.writeFileSync(path.join(basePath, 'dto', 'create-loai-cong-viec.dto.ts'), createDto);
fs.writeFileSync(path.join(basePath, 'dto', 'update-loai-cong-viec.dto.ts'), updateDto);
fs.writeFileSync(path.join(basePath, 'services', 'loai-cong-viec.service.ts'), service);
fs.writeFileSync(path.join(basePath, 'controllers', 'loai-cong-viec.controller.ts'), controller);
fs.writeFileSync(path.join(basePath, 'loai-cong-viec.module.ts'), module);

console.log('LoaiCongViec module created successfully');
