import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { SavedItemsQueryDto } from '../dto/saved-items-query.dto';

type SavedCursor = { createdAt: string; targetId: number };
type SavedPostAuthor = {
  id: number;
  name: string;
  avatar: string | null;
  headline: string | null;
};
type SavedPostComment = {
  id: number;
  parentId: number | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: SavedPostAuthor;
  _count: { replies: number };
};
type SavedPostSource = {
  id: number;
  content: string;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: SavedPostAuthor;
  likes: Array<{ userId: number }>;
  comments: SavedPostComment[];
  _count: { likes: number; comments: number };
};

@Injectable()
export class SavedItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async savePost(userId: number, postId: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    await this.prisma.savedPost.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId },
      update: {},
    });
    return { message: 'Post saved successfully' };
  }

  async unsavePost(userId: number, postId: number) {
    await this.prisma.savedPost.deleteMany({ where: { userId, postId } });
    return { message: 'Post removed from saved items' };
  }

  async saveJob(userId: number, jobId: number) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    await this.prisma.savedJob.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId },
      update: {},
    });
    return { message: 'Job saved successfully' };
  }

  async unsaveJob(userId: number, jobId: number) {
    await this.prisma.savedJob.deleteMany({ where: { userId, jobId } });
    return { message: 'Job removed from saved items' };
  }

  async getSavedPosts(userId: number, query: SavedItemsQueryDto) {
    const limit = query.limit ?? 10;
    const cursor = this.decodeCursor(query.cursor);
    const rows = await this.prisma.savedPost.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  postId: { lt: cursor.targetId },
                },
              ],
            }
          : {}),
      },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
      include: {
        post: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                avatar: true,
                headline: true,
              },
            },
            likes: { where: { userId }, select: { userId: true } },
            comments: {
              where: { parentId: null },
              take: 2,
              orderBy: { id: 'desc' },
              include: {
                _count: { select: { replies: true } },
                author: {
                  select: {
                    id: true,
                    name: true,
                    avatar: true,
                    headline: true,
                  },
                },
              },
            },
            _count: { select: { likes: true, comments: true } },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      message: 'Saved posts fetched successfully',
      content: {
        data: page.map((row) => this.formatPost(row.post)),
        nextCursor:
          hasMore && page.length
            ? this.encodeCursor({
                createdAt: page[page.length - 1].createdAt.toISOString(),
                targetId: page[page.length - 1].postId,
              })
            : null,
      },
    };
  }

  async getSavedJobs(userId: number, query: SavedItemsQueryDto) {
    const limit = query.limit ?? 12;
    const cursor = this.decodeCursor(query.cursor);
    const rows = await this.prisma.savedJob.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  jobId: { lt: cursor.targetId },
                },
              ],
            }
          : {}),
      },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { jobId: 'desc' }],
      include: {
        job: {
          include: {
            subcategory: { include: { category: true } },
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      message: 'Saved jobs fetched successfully',
      content: {
        data: page.map((row) => row.job),
        nextCursor:
          hasMore && page.length
            ? this.encodeCursor({
                createdAt: page[page.length - 1].createdAt.toISOString(),
                targetId: page[page.length - 1].jobId,
              })
            : null,
      },
    };
  }

  private formatPost(post: SavedPostSource) {
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
      viewerHasSaved: true,
      recentComments: [...post.comments]
        .reverse()
        .map(({ _count, ...comment }) => ({
          ...comment,
          replyCount: _count.replies,
        })),
    };
  }

  private encodeCursor(cursor: SavedCursor) {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeCursor(value?: string): SavedCursor | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as SavedCursor;
      if (
        !parsed.createdAt ||
        !Number.isInteger(parsed.targetId) ||
        parsed.targetId < 1 ||
        Number.isNaN(new Date(parsed.createdAt).getTime())
      ) {
        throw new Error('invalid');
      }
      return parsed;
    } catch {
      throw new BadRequestException('Invalid saved-items cursor');
    }
  }
}
