/**
 * Posts module controller for the social feed, post image uploads, likes, comments, and replies.
 * Routes: GET /api/posts/feed -> getFeed(), GET /api/posts/me/stats -> getMyStats(), POST /api/posts -> createPost(), DELETE /api/posts/:id -> deletePost(), PUT /api/posts/:id/like -> likePost(), DELETE /api/posts/:id/like -> unlikePost(), GET /api/posts/:id/comments -> getComments(), POST /api/posts/:id/comments -> createComment(), DELETE /api/posts/:postId/comments/:commentId -> deleteComment(), GET /api/posts/:postId/comments/:commentId/replies -> getReplies(), POST /api/posts/:postId/comments/:commentId/replies -> createReply(), PUT /api/posts/:postId/comments/:commentId -> updateComment().
 *
 * Calls: PostsService; StorageService; imageUploadOptions; JwtAuthGuard; CurrentUser; posts.dto
 * Used by:
 *   - src/modules/posts/posts.module.ts
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { StorageService } from '../../storage/services/storage.service';
import { imageUploadOptions } from '../../storage/utils/upload-options';
import {
  CommentsQueryDto,
  CreatePostCommentDto,
  CreatePostDto,
  FeedQueryDto,
  UpdatePostCommentDto,
} from '../dto/posts.dto';
import { PostsService } from '../services/posts.service';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly storage: StorageService,
  ) {}

  @Get('feed')
  getFeed(@CurrentUser() user: ValidatedUser, @Query() query: FeedQueryDto) {
    return this.postsService.getFeed(user.id, query);
  }

  @Get('me/stats')
  getMyStats(@CurrentUser() user: ValidatedUser) {
    return this.postsService.getMyStats(user.id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  async createPost(
    @CurrentUser() user: ValidatedUser,
    @Body() dto: CreatePostDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let uploaded: { url: string; publicId: string } | undefined;
    if (file) {
      const result = await this.storage.uploadImage(file, 'posts');
      uploaded = { url: result.url, publicId: result.key };
    }
    try {
      return await this.postsService.createPost(user.id, dto, uploaded);
    } catch (error) {
      if (uploaded) await this.storage.deleteImage(uploaded.publicId);
      throw error;
    }
  }

  @Delete(':id')
  deletePost(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.postsService.deletePost(id, user.id, user.role);
  }

  @Put(':id/like')
  likePost(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.postsService.likePost(id, user.id);
  }

  @Delete(':id/like')
  unlikePost(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.postsService.unlikePost(id, user.id);
  }

  @Get(':id/comments')
  getComments(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CommentsQueryDto,
  ) {
    return this.postsService.getComments(id, query);
  }

  @Post(':id/comments')
  createComment(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
    @Body() dto: CreatePostCommentDto,
  ) {
    if (!dto.content.trim())
      throw new BadRequestException('Comment content is required');
    return this.postsService.createComment(id, user.id, dto);
  }

  @Delete(':postId/comments/:commentId')
  deleteComment(
    @Param('postId', ParseIntPipe) postId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.postsService.deleteComment(
      postId,
      commentId,
      user.id,
      user.role,
    );
  }

  @Get(':postId/comments/:commentId/replies')
  getReplies(
    @Param('postId', ParseIntPipe) postId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Query() query: CommentsQueryDto,
  ) {
    return this.postsService.getReplies(postId, commentId, query);
  }

  @Post(':postId/comments/:commentId/replies')
  createReply(
    @Param('postId', ParseIntPipe) postId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: ValidatedUser,
    @Body() dto: CreatePostCommentDto,
  ) {
    return this.postsService.createReply(postId, commentId, user.id, dto);
  }

  @Put(':postId/comments/:commentId')
  updateComment(
    @Param('postId', ParseIntPipe) postId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: ValidatedUser,
    @Body() dto: UpdatePostCommentDto,
  ) {
    if (!dto.content.trim())
      throw new BadRequestException('Comment content is required');
    return this.postsService.updateComment(postId, commentId, user.id, dto);
  }
}
