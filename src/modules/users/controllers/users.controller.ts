import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Patch,
  Param,
  Delete,
  Query,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import {
  ReplaceProfileCertificationsDto,
  ReplaceProfileSkillsDto,
  UpdateMyProfileDto,
  UpsertPortfolioItemDto,
} from '../dto/profile.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { Role } from '../../../common/constants/roles';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Public()
  @Get('profile/:id')
  @ApiOperation({ summary: 'Get public user profile (like LinkedIn)' })
  getPublicProfile(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getPublicProfile(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new user (Admin only)' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get all users (Admin only)' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get('paginated-search')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Search users with pagination (Admin only)' })
  findAllWithPagination(@Query() paginationDto: PaginationDto) {
    return this.usersService.findAllWithPagination(paginationDto);
  }

  @Get('search/:name')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Search users by name (Admin only)' })
  searchByName(@Param('name') name: string) {
    return this.usersService.searchByName(name);
  }

  @Get('me/profile')
  @ApiOperation({ summary: 'Get editable profile for current user' })
  getMyProfile(@CurrentUser() user: ValidatedUser) {
    return this.usersService.getMyProfile(user.id);
  }

  @Patch('me/profile')
  @ApiOperation({ summary: 'Update editable profile fields for current user' })
  updateMyProfile(
    @Body() updateProfileDto: UpdateMyProfileDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.usersService.updateMyProfile(user.id, updateProfileDto);
  }

  @Put('me/profile/skills')
  @ApiOperation({ summary: 'Replace current user profile skills' })
  replaceProfileSkills(
    @Body() replaceSkillsDto: ReplaceProfileSkillsDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.usersService.replaceProfileSkills(user.id, replaceSkillsDto);
  }

  @Put('me/profile/certifications')
  @ApiOperation({ summary: 'Replace current user profile certifications' })
  replaceProfileCertifications(
    @Body() replaceCertificationsDto: ReplaceProfileCertificationsDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.usersService.replaceProfileCertifications(
      user.id,
      replaceCertificationsDto,
    );
  }

  @Post('me/profile/portfolio')
  @ApiOperation({ summary: 'Create current user portfolio item' })
  createPortfolioItem(
    @Body() portfolioDto: UpsertPortfolioItemDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.usersService.createPortfolioItem(user.id, portfolioDto);
  }

  @Put('me/profile/portfolio/:id')
  @ApiOperation({ summary: 'Update current user portfolio item' })
  updatePortfolioItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() portfolioDto: UpsertPortfolioItemDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.usersService.updatePortfolioItem(user.id, id, portfolioDto);
  }

  @Delete('me/profile/portfolio/:id')
  @ApiOperation({ summary: 'Delete current user portfolio item' })
  deletePortfolioItem(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.usersService.deletePortfolioItem(user.id, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user details (own profile or admin)' })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    if (id !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('You can only view your own profile');
    }
    return this.usersService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update user (own profile or admin)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    if (id !== user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('You can only update your own profile');
    }
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete user (Admin only)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }

  @Post('upload-avatar')
  @ApiOperation({ summary: 'Upload avatar for current user' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|gif|webp)$/)) {
          return callback(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: ValidatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    const result = await this.cloudinaryService.uploadImage(file, 'avatars');
    return this.usersService.uploadAvatar(user.id, result.secure_url);
  }

  @Post('upload-cover')
  @ApiOperation({ summary: 'Upload cover image for current user' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|gif|webp)$/)) {
          return callback(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadCover(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: ValidatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('Cover image file is required');
    }

    const result = await this.cloudinaryService.uploadImage(file, 'covers');
    return this.usersService.uploadCover(user.id, result.secure_url);
  }
}
