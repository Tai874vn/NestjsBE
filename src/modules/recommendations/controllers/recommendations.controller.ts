import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ValidatedUser } from '../../../types';
import { RecommendationQueryDto } from '../dto/recommendation-query.dto';
import { RecommendationsService } from '../services/recommendations.service';

@ApiTags('Recommendations')
@ApiBearerAuth()
@Controller('recommendations')
@UseGuards(JwtAuthGuard)
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get('jobs')
  @ApiOperation({ summary: 'Recommend jobs for the current user' })
  recommendJobs(@CurrentUser() user: ValidatedUser, @Query() query: RecommendationQueryDto) {
    return this.recommendationsService.recommendJobsForUser(user.id, query);
  }

  @Get('jobs/:jobId/candidates')
  @ApiOperation({ summary: 'Recommend candidates for a job owned by the current user' })
  recommendCandidates(
    @Param('jobId', ParseIntPipe) jobId: number,
    @CurrentUser() user: ValidatedUser,
    @Query() query: RecommendationQueryDto,
  ) {
    return this.recommendationsService.recommendCandidatesForJob(jobId, user.id, user.role, query);
  }
}
