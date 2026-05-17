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
import { JobsService } from '../services/jobs.service';
import { CreateJobDto } from '../dto/create-job.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post()
  create(
    @Body() createDto: CreateJobDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.jobsService.create(createDto, user.id);
  }

  @Public()
  @Get()
  findAll() {
    return this.jobsService.findAll();
  }

  @Public()
  @Get('paginated-search')
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.jobsService.findAllWithPagination(paginationDto);
  }

  @Public()
  @Get('category-menu')
  getCategoryMenu() {
    return this.jobsService.getCategoryMenu();
  }

  @Public()
  @Get('subcategories/by-category/:categoryId')
  getSubcategoriesByCategory(@Param('categoryId', ParseIntPipe) id: number) {
    return this.jobsService.getSubcategoriesByCategory(id);
  }

  @Public()
  @Get('by-subcategory/:subcategoryId')
  getJobsBySubcategory(@Param('subcategoryId', ParseIntPipe) id: number) {
    return this.jobsService.getJobsBySubcategory(id);
  }

  @Public()
  @Get('details/:jobId')
  getJobDetails(@Param('jobId', ParseIntPipe) id: number) {
    return this.jobsService.getJobDetails(id);
  }

  @Public()
  @Get('search/:name')
  searchByName(@Param('name') name: string) {
    return this.jobsService.searchByName(name);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.jobsService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateJobDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.jobsService.update(id, updateDto, user.id, user.role);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.jobsService.remove(id, user.id, user.role);
  }

  @Post('upload-image/:jobId')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    }),
  )
  async uploadImage(
    @Param('jobId', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: ValidatedUser,
  ) {
    const result = await this.cloudinaryService.uploadImage(file, 'jobs');
    return this.jobsService.uploadImage(
      id,
      result.secure_url,
      user.id,
      user.role,
    );
  }
}
