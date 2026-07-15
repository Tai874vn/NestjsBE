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
import { memoryStorage } from 'multer';
import { JobsService } from '../services/jobs.service';
import { CreateJobDto } from '../dto/create-job.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { JobCursorQueryDto } from '../dto/job-cursor-query.dto';
import { JobSearchQueryDto } from '../dto/job-search-query.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { imageFileFilter } from '../../../common/image-file-filter';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post()
  @Roles(Role.USER, Role.ADMIN)
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
  @Get('cursor')
  findAllWithCursor(@Query() query: JobCursorQueryDto) {
    return this.jobsService.findAllWithCursor(query);
  }

  @Public()
  @Get('paginated-search')
  findAllWithPagination(@Query() query: JobSearchQueryDto) {
    return this.jobsService.findAllWithPagination(query);
  }

  @Public()
  @Get('by-creator/:creatorId')
  findByCreator(
    @Param('creatorId', ParseIntPipe) creatorId: number,
    @Query() paginationDto: PaginationDto,
  ) {
    return this.jobsService.findByCreator(creatorId, paginationDto);
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
      fileFilter: imageFileFilter,
    }),
  )
  async uploadImage(
    @Param('jobId', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: ValidatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Job image file is required');
    }

    await this.jobsService.ensureCanManageJob(id, user.id, user.role);

    const result = await this.cloudinaryService.uploadImage(file, 'jobs');
    try {
      return await this.jobsService.uploadImage(
        id,
        result.secure_url,
        user.id,
        user.role,
      );
    } catch (error) {
      await this.cloudinaryService.deleteImage(result.public_id);
      throw error;
    }
  }
}
