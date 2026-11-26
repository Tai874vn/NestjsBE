import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { StorageService } from '../../storage/services/storage.service';
import { Role } from '../../../common/constants/roles';
import { NotificationsService } from '../../notifications/services/notifications.service';
import {
  CommentsQueryDto,
  CreatePostCommentDto,
  CreatePostDto,
  FeedQueryDto,
  UpdatePostCommentDto,
} from '../dto/posts.dto';

type UploadedPostImage = { url: string; publicId: string };
type FeedCursor = { phase: 'connections' | 'global'; id: number };
type FeedPostAuthor = {
  id: number;
  name: string;
  avatar: string | null;
  headline: string | null;
};
type FeedPostComment = {
  id: number;
  parentId: number | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: FeedPostAuthor;
  _count: { replies: number };
};
type FeedPostSource = {
  id: number;
  content: string;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: FeedPostAuthor;
  likes: Array<{ userId: number }>;
  savedBy: Array<{ userId: number }>;
  comments: FeedPostComment[];
  _count: { likes: number; comments: number };
};

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional()
    private readonly notifications?: NotificationsService,
  ) {}

  async createPost(
    authorId: number,
    dto: CreatePostDto,
    image?: UploadedPostImage,
  ) {
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

    return {
      message: 'Post created successfully',
      content: this.formatPost(post),
    };
  }

  // GET /api/posts/feed — Home feed: own and connected people first, then others, by cursor.
  // Query: connection.findMany, then the post query below in this method
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

    let page: FeedPostSource[] = [];
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

  // GET /api/posts/me/stats — Post and like counts on the left rail.
  // Query: post.count, postLike.count
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

  // DELETE /api/posts/:id — Author deletes a post and its image.
  // Query: post.findUnique, post.delete
  async deletePost(postId: number, userId: number, role: Role) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true, imagePublicId: true, imageUrl: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    await this.prisma.post.delete({ where: { id: postId } });
    const imageRef = post.imagePublicId ?? post.imageUrl;
    if (imageRef) await this.storage.deleteImage(imageRef);
    return { message: 'Post deleted successfully' };
  }

  // PUT /api/posts/:id/like — Likes a post (a second like is ignored).
  // Query: postLike.create
  async likePost(postId: number, userId: number) {
    const post = await this.ensurePost(postId);
    try {
      await this.prisma.postLike.create({
        data: { postId, userId },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return { message: 'Post liked successfully' };
      }
      throw error;
    }
    await this.notifications?.notifyPostLike({
      actorId: userId,
      recipientId: post.authorId,
      postId,
      postTitle: post.content,
    });
    return { message: 'Post liked successfully' };
  }

  // DELETE /api/posts/:id/like — Removes the like.
  // Query: postLike.deleteMany
  async unlikePost(postId: number, userId: number) {
    await this.ensurePost(postId);
    await this.prisma.postLike.deleteMany({ where: { postId, userId } });
    return { message: 'Post unliked successfully' };
  }

  // GET /api/posts/:id/comments — Top-level comments of a post, by page.
  // Query: see listComments()
  async getComments(postId: number, query: CommentsQueryDto) {
    await this.ensurePost(postId);
    return {
      message: 'Post comments fetched successfully',
      content: await this.listComments(postId, null, query),
    };
  }

  // GET /api/posts/:postId/comments/:commentId/replies — Replies under one comment, by page.
  // Query: see listComments()
  async getReplies(postId: number, commentId: number, query: CommentsQueryDto) {
    await this.ensureRootComment(postId, commentId);
    return {
      message: 'Comment replies fetched successfully',
      content: await this.listComments(postId, commentId, query),
    };
  }

  private async listComments(
    postId: number,
    parentId: number | null,
    query: CommentsQueryDto,
  ) {
    const limit = query.limit ?? 20;
    const comments = await this.prisma.postComment.findMany({
      where: {
        postId,
        parentId,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      take: limit + 1,
      orderBy: { id: 'desc' },
      include: this.commentInclude(),
    });
    const hasMore = comments.length > limit;
    const data = comments
      .slice(0, limit)
      .map((comment) => this.formatComment(comment));
    return {
      data,
      nextCursor: hasMore && data.length ? data[data.length - 1].id : null,
    };
  }

  // POST /api/posts/:id/comments — Adds a comment to a post.
  // Query: postComment.create
  async createComment(
    postId: number,
    authorId: number,
    dto: CreatePostCommentDto,
  ) {
    const post = await this.ensurePost(postId);
    const comment = await this.prisma.postComment.create({
      data: { postId, authorId, content: dto.content.trim() },
      include: this.commentInclude(),
    });
    await this.notifications?.notifyPostComment({
      actorId: authorId,
      recipientId: post.authorId,
      postId,
      commentId: comment.id,
      preview: comment.content,
      postTitle: post.content,
    });
    return {
      message: 'Comment created successfully',
      content: this.formatComment(comment),
    };
  }

  // POST /api/posts/:postId/comments/:commentId/replies — Replies to a comment (one level deep).
  // Query: postComment.create inside this method
  async createReply(
    postId: number,
    commentId: number,
    authorId: number,
    dto: CreatePostCommentDto,
  ) {
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Reply content is required');
    const post = await this.ensurePost(postId);
    const parent = await this.ensureRootComment(postId, commentId);
    const reply = await this.prisma.postComment
      .create({
        data: { postId, parentId: commentId, authorId, content },
        include: this.commentInclude(),
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new NotFoundException(
            'Post or parent comment no longer exists',
          );
        }
        throw error;
      });
    await this.notifications?.notifyPostComment({
      actorId: authorId,
      recipientId: parent.authorId,
      postId,
      commentId: reply.id,
      parentCommentId: commentId,
      preview: reply.content,
      postTitle: post.content,
    });
    return {
      message: 'Reply created successfully',
      content: this.formatComment(reply),
    };
  }

  // PUT /api/posts/:postId/comments/:commentId — Author edits a comment.
  // Query: postComment.findUnique, postComment.update
  async updateComment(
    postId: number,
    commentId: number,
    userId: number,
    dto: UpdatePostCommentDto,
  ) {
    const comment = await this.prisma.postComment.findUnique({
      where: { id: commentId },
      select: { postId: true, authorId: true },
    });
    if (!comment || comment.postId !== postId)
      throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId)
      throw new ForbiddenException('You can only edit your own comments');

    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Comment content is required');
    const updated = await this.prisma.postComment.update({
      where: { id: commentId },
      data: { content },
      include: this.commentInclude(),
    });
    return {
      message: 'Comment updated successfully',
      content: this.formatComment(updated),
    };
  }

  // DELETE /api/posts/:postId/comments/:commentId — Author deletes a comment.
  // Query: postComment.findUnique, postComment.delete
  async deleteComment(
    postId: number,
    commentId: number,
    userId: number,
    role: Role,
  ) {
    const comment = await this.prisma.postComment.findUnique({
      where: { id: commentId },
      select: { postId: true, authorId: true },
    });
    if (!comment || comment.postId !== postId)
      throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.prisma.postComment.delete({ where: { id: commentId } });
    return { message: 'Comment deleted successfully' };
  }

  private async ensurePost(postId: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, content: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  private async ensureRootComment(postId: number, commentId: number) {
    const parent = await this.prisma.postComment.findUnique({
      where: { id: commentId },
      select: { id: true, postId: true, parentId: true, authorId: true },
    });
    if (!parent || parent.postId !== postId) {
      throw new NotFoundException('Parent comment not found');
    }
    if (parent.parentId !== null) {
      throw new BadRequestException('Replies must target a top-level comment');
    }
    return parent;
  }

  private commentInclude() {
    return {
      author: {
        select: { id: true, name: true, avatar: true, headline: true },
      },
      _count: { select: { replies: true } },
    } as const;
  }

  private formatComment<T extends { _count: { replies: number } }>(comment: T) {
    const { _count, ...data } = comment;
    return { ...data, replyCount: _count.replies };
  }

  private postInclude(userId: number) {
    return {
      author: {
        select: { id: true, name: true, avatar: true, headline: true },
      },
      likes: { where: { userId }, select: { userId: true } },
      savedBy: { where: { userId }, select: { userId: true } },
      comments: {
        where: { parentId: null },
        take: 5,
        orderBy: { id: 'desc' as const },
        include: this.commentInclude(),
      },
      _count: { select: { likes: true, comments: true } },
    };
  }

  private formatPost(post: FeedPostSource) {
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
      recentComments: [...post.comments]
        .reverse()
        .map((comment) => this.formatComment(comment)),
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

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
