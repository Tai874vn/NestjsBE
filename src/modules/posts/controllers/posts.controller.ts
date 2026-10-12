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
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { imageFileFilter } from '../../../common/image-file-filter';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
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
    private readonly cloudinary: CloudinaryService,
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
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: imageFileFilter,
    }),
  )
  async createPost(
    @CurrentUser() user: ValidatedUser,
    @Body() dto: CreatePostDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let uploaded: { url: string; publicId: string } | undefined;
    if (file) {
      const result = await this.cloudinary.uploadImage(file, 'posts');
      uploaded = { url: result.secure_url, publicId: result.public_id };
    }
    try {
      return await this.postsService.createPost(user.id, dto, uploaded);
    } catch (error) {
      if (uploaded) await this.cloudinary.deleteImage(uploaded.publicId);
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
