import {
  Controller,
  Get,
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
  @ApiOperation({ summary: 'Recommend jobs for the current user' })
  recommendJobs(
    @CurrentUser() user: ValidatedUser,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationsService.recommendJobsForUser(
      user.id,
      query,
      user.role,
    );
  }

  @Get('hiring-posts/:hiringPostId/candidates')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  @ApiOperation({
    summary:
      'Recommend candidates for a recruiter hiring post owned by the current user',
  })
  recommendCandidatesForHiringPost(
    @Param('hiringPostId', ParseIntPipe) hiringPostId: number,
    @CurrentUser() user: ValidatedUser,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationsService.recommendCandidatesForHiringPost(
      hiringPostId,
      user.id,
      user.role,
      query,
    );
  }
}
