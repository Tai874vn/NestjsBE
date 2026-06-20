import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { SavedItemsQueryDto } from '../dto/saved-items-query.dto';
import { SavedItemsService } from '../services/saved-items.service';

@Controller('saved')
@UseGuards(JwtAuthGuard)
export class SavedItemsController {
  constructor(private readonly savedItemsService: SavedItemsService) {}

  @Get('posts')
  getSavedPosts(
    @CurrentUser() user: ValidatedUser,
    @Query() query: SavedItemsQueryDto,
  ) {
    return this.savedItemsService.getSavedPosts(user.id, query);
  }

  @Put('posts/:postId')
  savePost(
    @CurrentUser() user: ValidatedUser,
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.savedItemsService.savePost(user.id, postId);
  }

  @Delete('posts/:postId')
  unsavePost(
    @CurrentUser() user: ValidatedUser,
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.savedItemsService.unsavePost(user.id, postId);
  }

  @Get('jobs')
  getSavedJobs(
    @CurrentUser() user: ValidatedUser,
    @Query() query: SavedItemsQueryDto,
  ) {
    return this.savedItemsService.getSavedJobs(user.id, query);
  }

  @Put('jobs/:jobId')
  saveJob(
    @CurrentUser() user: ValidatedUser,
    @Param('jobId', ParseIntPipe) jobId: number,
  ) {
    return this.savedItemsService.saveJob(user.id, jobId);
  }

  @Delete('jobs/:jobId')
  unsaveJob(
    @CurrentUser() user: ValidatedUser,
    @Param('jobId', ParseIntPipe) jobId: number,
  ) {
    return this.savedItemsService.unsaveJob(user.id, jobId);
  }
}
