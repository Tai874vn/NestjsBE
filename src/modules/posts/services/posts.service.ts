import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { Role } from '../../../common/constants/roles';
import {
  CommentsQueryDto,
  CreatePostCommentDto,
  CreatePostDto,
  FeedQueryDto,
  UpdatePostCommentDto,
} from '../dto/posts.dto';

type UploadedPostImage = { url: string; publicId: string };
type FeedCursor = { phase: 'connections' | 'global'; id: number };

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async createPost(authorId: number, dto: CreatePostDto, image?: UploadedPostImage) {
    const content = dto.content?.trim() ?? '';
    if (!content && !image) {
      throw new BadRequestException('Post content or image is required');
    }

    const post = await this.prisma.post.create({
      data: {
        authorId,
        content,
        imageUrl: image?.url,
        imagePublicId: image?.publicId,
      },
      include: this.postInclude(authorId),
    });

    return { message: 'Post created successfully', content: this.formatPost(post) };
  }

  async getFeed(userId: number, query: FeedQueryDto) {
    const limit = query.limit ?? 10;
    const cursor = this.decodeFeedCursor(query.cursor);
    const connections = await this.prisma.connection.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { recipientId: userId }],
      },
      select: { requesterId: true, recipientId: true },
    });
    const priorityIds = [
      userId,
      ...connections.map((connection) =>
        connection.requesterId === userId
          ? connection.recipientId
          : connection.requesterId,
      ),
    ].filter((id, index, values) => values.indexOf(id) === index);

    let page: any[] = [];
    let nextCursor: string | null = null;

    if (!cursor || cursor.phase === 'connections') {
      const connectionPosts = await this.findFeedPosts({
        userId,
        authorIds: priorityIds,
        cursorId: cursor?.id,
        take: limit + 1,
      });
      if (connectionPosts.length > limit) {
        page = connectionPosts.slice(0, limit);
        nextCursor = this.encodeFeedCursor({
          phase: 'connections',
          id: page[page.length - 1].id,
        });
      } else {
        page = connectionPosts;
        const remaining = limit - page.length;
        if (remaining > 0) {
          const globalPosts = await this.findFeedPosts({
            userId,
            excludedAuthorIds: priorityIds,
            take: remaining + 1,
          });
          const hasMoreGlobal = globalPosts.length > remaining;
          const globalPage = globalPosts.slice(0, remaining);
          page = [...page, ...globalPage];
          nextCursor =
            hasMoreGlobal && globalPage.length
              ? this.encodeFeedCursor({
                  phase: 'global',
                  id: globalPage[globalPage.length - 1].id,
                })
              : null;
        }
      }
    } else {
      const globalPosts = await this.findFeedPosts({
        userId,
        excludedAuthorIds: priorityIds,
        cursorId: cursor.id,
        take: limit + 1,
      });
      const hasMore = globalPosts.length > limit;
      page = globalPosts.slice(0, limit);
      nextCursor =
        hasMore && page.length
          ? this.encodeFeedCursor({
              phase: 'global',
              id: page[page.length - 1].id,
            })
          : null;
    }

    const data = page.map((post) => this.formatPost(post));

    return {
      message: 'Feed fetched successfully',
      content: {
        data,
        nextCursor,
      },
    };
  }

  async getMyStats(userId: number) {
    const [posts, reactions] = await Promise.all([
      this.prisma.post.count({ where: { authorId: userId } }),
      this.prisma.postLike.count({ where: { post: { authorId: userId } } }),
    ]);

    return {
      message: 'Post stats fetched successfully',
      content: { posts, reactions },
    };
  }

  async deletePost(postId: number, userId: number, role: Role) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true, imagePublicId: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    await this.prisma.post.delete({ where: { id: postId } });
    if (post.imagePublicId) await this.cloudinary.deleteImage(post.imagePublicId);
    return { message: 'Post deleted successfully' };
  }

  async likePost(postId: number, userId: number) {
    await this.ensurePost(postId);
    await this.prisma.postLike.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {},
    });
    return { message: 'Post liked successfully' };
  }

  async unlikePost(postId: number, userId: number) {
    await this.ensurePost(postId);
    await this.prisma.postLike.deleteMany({ where: { postId, userId } });
    return { message: 'Post unliked successfully' };
  }

  async getComments(postId: number, query: CommentsQueryDto) {
    await this.ensurePost(postId);
    const limit = query.limit ?? 20;
    const comments = await this.prisma.postComment.findMany({
      where: {
        postId,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      take: limit + 1,
      orderBy: { id: 'desc' },
      include: { author: { select: { id: true, name: true, avatar: true, headline: true } } },
    });
    const hasMore = comments.length > limit;
    const data = comments.slice(0, limit);
    return {
      message: 'Post comments fetched successfully',
      content: {
        data,
        nextCursor: hasMore && data.length ? data[data.length - 1].id : null,
      },
    };
  }

  async createComment(postId: number, authorId: number, dto: CreatePostCommentDto) {
    await this.ensurePost(postId);
    const comment = await this.prisma.postComment.create({
      data: { postId, authorId, content: dto.content.trim() },
      include: { author: { select: { id: true, name: true, avatar: true, headline: true } } },
    });
    return { message: 'Comment created successfully', content: comment };
  }

  async updateComment(postId: number, commentId: number, userId: number, dto: UpdatePostCommentDto) {
    const comment = await this.prisma.postComment.findUnique({
      where: { id: commentId },
      select: { postId: true, authorId: true },
    });
    if (!comment || comment.postId !== postId) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId) throw new ForbiddenException('You can only edit your own comments');

    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Comment content is required');
    const updated = await this.prisma.postComment.update({
      where: { id: commentId },
      data: { content },
      include: { author: { select: { id: true, name: true, avatar: true, headline: true } } },
    });
    return { message: 'Comment updated successfully', content: updated };
  }

  async deleteComment(postId: number, commentId: number, userId: number, role: Role) {
    const comment = await this.prisma.postComment.findUnique({
      where: { id: commentId },
      select: { postId: true, authorId: true },
    });
    if (!comment || comment.postId !== postId) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.prisma.postComment.delete({ where: { id: commentId } });
    return { message: 'Comment deleted successfully' };
  }

  private async ensurePost(postId: number) {
    const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) throw new NotFoundException('Post not found');
  }

  private postInclude(userId: number) {
    return {
      author: { select: { id: true, name: true, avatar: true, headline: true } },
      likes: { where: { userId }, select: { userId: true } },
      savedBy: { where: { userId }, select: { userId: true } },
      comments: {
        take: 5,
        orderBy: { id: 'desc' as const },
        include: { author: { select: { id: true, name: true, avatar: true, headline: true } } },
      },
      _count: { select: { likes: true, comments: true } },
    };
  }

  private formatPost(post: any) {
    return {
      id: post.id,
      content: post.content,
      imageUrl: post.imageUrl,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: post.author,
      likeCount: post._count.likes,
      commentCount: post._count.comments,
      viewerHasLiked: post.likes.length > 0,
      viewerHasSaved: post.savedBy.length > 0,
      recentComments: [...post.comments].reverse(),
    };
  }

  private findFeedPosts({
    userId,
    authorIds,
    excludedAuthorIds,
    cursorId,
    take,
  }: {
    userId: number;
    authorIds?: number[];
    excludedAuthorIds?: number[];
    cursorId?: number;
    take: number;
  }) {
    return this.prisma.post.findMany({
      where: {
        ...(authorIds ? { authorId: { in: authorIds } } : {}),
        ...(excludedAuthorIds
          ? { authorId: { notIn: excludedAuthorIds } }
          : {}),
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      take,
      orderBy: { id: 'desc' },
      include: this.postInclude(userId),
    });
  }

  private encodeFeedCursor(cursor: FeedCursor) {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeFeedCursor(value?: string): FeedCursor | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as FeedCursor;
      if (
        (parsed.phase !== 'connections' && parsed.phase !== 'global') ||
        !Number.isInteger(parsed.id) ||
        parsed.id < 1
      ) {
        throw new Error('invalid');
      }
      return parsed;
    } catch {
      throw new BadRequestException('Invalid feed cursor');
    }
  }
}
