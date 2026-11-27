/**
 * Recommendations module controller for AI quota checks and job or candidate matching.
 * Routes: GET /api/recommendations/quota -> getQuota(), GET /api/recommendations/jobs -> getRecommendedJobs(), POST /api/recommendations/jobs -> runRecommendedJobs(), GET /api/recommendations/hiring-posts/:hiringPostId/candidates -> getRecommendedCandidatesForHiringPost(), POST /api/recommendations/hiring-posts/:hiringPostId/candidates -> runRecommendedCandidatesForHiringPost().
 *
 * Calls: RecommendationsService; RecommendationQueryDto; JwtAuthGuard; RolesGuard; Roles; CurrentUser; Role
 * Used by:
 *   - src/modules/recommendations/recommendations.module.ts
 */

import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ValidatedUser } from '../../../types';
import { RecommendationQueryDto } from '../dto/recommendation-query.dto';
import { RecommendationsService } from '../services/recommendations.service';

@ApiTags('Recommendations')
@ApiBearerAuth()
@Controller('recommendations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get('quota')
  @ApiOperation({ summary: 'Get the current user AI recommendation quota' })
  getQuota(@CurrentUser() user: ValidatedUser) {
    return this.recommendationsService.getQuotaForUser(user.id, user.role);
  }

  @Get('jobs')
  @Roles(Role.USER, Role.ADMIN)
  @ApiOperation({ summary: 'Get the current user saved job recommendations' })
  getRecommendedJobs(
    @CurrentUser() user: ValidatedUser,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationsService.recommendJobsForUser(
      user.id,
      { ...query, cacheOnly: true, forceRefresh: false },
      user.role,
    );
  }

  @Post('jobs')
  @Roles(Role.USER, Role.ADMIN)
  @ApiOperation({ summary: 'Run job recommendations for the current user' })
  runRecommendedJobs(
    @CurrentUser() user: ValidatedUser,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationsService.recommendJobsForUser(
      user.id,
      { ...query, cacheOnly: false },
      user.role,
    );
  }

  @Get('hiring-posts/:hiringPostId/candidates')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  @ApiOperation({
    summary: 'Get saved candidate recommendations for a hiring post',
  })
  getRecommendedCandidatesForHiringPost(
    @Param('hiringPostId', ParseIntPipe) hiringPostId: number,
    @CurrentUser() user: ValidatedUser,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationsService.recommendCandidatesForHiringPost(
      hiringPostId,
      user.id,
      user.role,
      { ...query, cacheOnly: true, forceRefresh: false },
    );
  }

  @Post('hiring-posts/:hiringPostId/candidates')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  @ApiOperation({ summary: 'Run candidate recommendations for a hiring post' })
  runRecommendedCandidatesForHiringPost(
    @Param('hiringPostId', ParseIntPipe) hiringPostId: number,
    @CurrentUser() user: ValidatedUser,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationsService.recommendCandidatesForHiringPost(
      hiringPostId,
      user.id,
      user.role,
      { ...query, cacheOnly: false },
    );
  }
}
