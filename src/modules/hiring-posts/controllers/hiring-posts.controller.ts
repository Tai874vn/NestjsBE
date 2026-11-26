import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalAuth } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ValidatedUser } from '../../../types';
import { ApplyHiringPostDto } from '../dto/apply-hiring-post.dto';
import { CreateHiringPostDto } from '../dto/create-hiring-post.dto';
import { HiringPostQueryDto } from '../dto/hiring-post-query.dto';
import { PostApplicationsQueryDto } from '../dto/post-applications-query.dto';
import { UpdateHiringPostDto } from '../dto/update-hiring-post.dto';
import { HiringPostsService } from '../services/hiring-posts.service';

@Controller('hiring-posts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HiringPostsController {
  constructor(private readonly hiringPostsService: HiringPostsService) {}

  // Visitors can browse open posts; signed-in candidates also see which ones they applied to.
  // @find hiring-posts results list api [all] — GET /api/hiring-posts: the public list (search, filters, sort, page)
  @Get()
  @OptionalAuth()
  findOpen(
    @Query() query: HiringPostQueryDto,
    @CurrentUser() user: ValidatedUser | null,
  ) {
    return this.hiringPostsService.findOpen(query, user?.id);
  }

  // Declared before ':id' so "locations" and "facets" are not read as a post id.
  // Same for everyone, so browsers and proxies may keep it for 5 minutes.
  // @find hiring-posts filters location api [all] — GET /api/hiring-posts/locations
  @Get('locations')
  @OptionalAuth()
  @Header('Cache-Control', 'public, max-age=300')
  findLocations() {
    return this.hiringPostsService.findLocations();
  }

  // @find hiring-posts filters counts api [all] — GET /api/hiring-posts/facets: numbers beside each filter choice
  @Get('facets')
  @OptionalAuth()
  findFacets(@Query() query: HiringPostQueryDto) {
    return this.hiringPostsService.findFacets(query);
  }

  // @find my-hiring-posts results list api [recruiter] — GET /api/hiring-posts/mine
  @Get('mine')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  findMine(@Query() query: PaginationDto, @CurrentUser() user: ValidatedUser) {
    return this.hiringPostsService.findMine(user.id, query);
  }

  @Get('applications/me')
  @Roles(Role.USER, Role.ADMIN)
  findMyApplications(
    @Query() query: PaginationDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiringPostsService.findMyApplications(user.id, query);
  }

  @Get(':id')
  @OptionalAuth()
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser | null,
  ) {
    return this.hiringPostsService.findOne(id, user?.id, user?.role);
  }

  @Post()
  @Roles(Role.EMPLOYER, Role.ADMIN)
  create(@Body() dto: CreateHiringPostDto, @CurrentUser() user: ValidatedUser) {
    return this.hiringPostsService.create(dto, user.id);
  }

  // @find my-hiring-posts form update api [owner] — PATCH /api/hiring-posts/:id
  @Patch(':id')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHiringPostDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiringPostsService.update(id, dto, user.id, user.role);
  }

  @Delete(':id')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiringPostsService.remove(id, user.id, user.role);
  }

  @Post(':id/seniority')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  predictSeniority(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiringPostsService.predictSeniority(id, user.id, user.role);
  }

  // @find hiring-posts card apply api [candidate] — POST /api/hiring-posts/:id/applications
  @Post(':id/applications')
  @Roles(Role.USER, Role.ADMIN)
  apply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyHiringPostDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiringPostsService.apply(id, user.id, dto);
  }

  @Get(':id/applications')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  findApplicationsForPost(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PostApplicationsQueryDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.hiringPostsService.findApplicationsForPost(
      id,
      user.id,
      user.role,
      query,
    );
  }
}
