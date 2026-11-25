import {
  Controller,
  Get,
  Header,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { CategoriesService } from '../services/categories.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { PUBLIC_TAXONOMY_CACHE_CONTROL } from '../../../common/middleware/cache-control.middleware';

@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() createDto: CreateCategoryDto) {
    return this.categoriesService.create(createDto);
  }

  @Public()
  @Get()
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  findAll() {
    return this.categoriesService.findAll();
  }

  @Public()
  @Get('paginated-search')
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.categoriesService.findAllWithPagination(paginationDto);
  }

  @Public()
  @Get(':id')
  @Header('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.findOne(id);
  }

  @Put(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.remove(id);
  }
}
