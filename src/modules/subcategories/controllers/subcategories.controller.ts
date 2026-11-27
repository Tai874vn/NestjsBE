/**
 * HTTP controller for the subcategories module to browse subcategories and let admins manage them and upload images. Routes: POST /api/subcategories -> create(), GET /api/subcategories -> findAll(), GET /api/subcategories/paginated-search -> findAllWithPagination(), GET /api/subcategories/:id -> findOne(), PUT /api/subcategories/:id -> update(), DELETE /api/subcategories/:id -> remove(), POST /api/subcategories/create-group -> createGroup(), POST /api/subcategories/upload-image/:subcategoryId -> uploadImage(), PUT /api/subcategories/update-group/:id -> updateGroup().
 *
 * Calls: SubcategoriesService; StorageService; imageUploadOptions; JwtAuthGuard; RolesGuard; Public; Roles; Role
 * Used by:
 *   - src/modules/subcategories/subcategories.module.ts
 */

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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubcategoriesService } from '../services/subcategories.service';
import { CreateSubcategoryDto } from '../dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from '../dto/update-subcategory.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { StorageService } from '../../storage/services/storage.service';
import { imageUploadOptions } from '../../storage/utils/upload-options';

@Controller('subcategories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubcategoriesController {
  constructor(
    private readonly subcategoriesService: SubcategoriesService,
    private readonly storageService: StorageService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() createDto: CreateSubcategoryDto) {
    return this.subcategoriesService.create(createDto);
  }

  @Public()
  @Get()
  findAll() {
    return this.subcategoriesService.findAll();
  }

  @Public()
  @Get('paginated-search')
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.subcategoriesService.findAllWithPagination(paginationDto);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.subcategoriesService.findOne(id);
  }

  @Put(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateSubcategoryDto,
  ) {
    return this.subcategoriesService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.subcategoriesService.remove(id);
  }

  @Post('create-group')
  @Roles(Role.ADMIN)
  createGroup(@Body() createDto: CreateSubcategoryDto) {
    return this.subcategoriesService.create(createDto);
  }

  @Post('upload-image/:subcategoryId')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadImage(
    @Param('subcategoryId', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Subcategory image file is required');
    }

    const result = await this.storageService.uploadImage(file, 'subcategories');
    try {
      return await this.subcategoriesService.uploadImage(id, result.url);
    } catch (error) {
      await this.storageService.deleteImage(result.key);
      throw error;
    }
  }

  @Put('update-group/:id')
  @Roles(Role.ADMIN)
  updateGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateSubcategoryDto,
  ) {
    return this.subcategoriesService.update(id, updateDto);
  }
}
