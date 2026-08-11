import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HiringApplicationStatus,
  HiringPostStatus,
  Prisma,
} from '@prisma/client';
import { Role } from '../../../common/constants/roles';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PrismaService } from '../../../prisma.service';
import { AiRecommendationClient } from '../../recommendations/services/ai-recommendation.client';
import { RecommendationPayloadMapperService } from '../../recommendations/services/recommendation-payload-mapper.service';
import { ApplyHiringPostDto } from '../dto/apply-hiring-post.dto';
import { CreateHiringPostDto } from '../dto/create-hiring-post.dto';
import { UpdateHiringPostDto } from '../dto/update-hiring-post.dto';

const hiringPostInclude = {
  recruiter: {
    select: {
      id: true,
      name: true,
      avatar: true,
      headline: true,
    },
  },
  _count: {
    select: {
      applications: true,
    },
  },
} satisfies Prisma.HiringPostInclude;

type HiringPostWithMeta = Prisma.HiringPostGetPayload<{
  include: typeof hiringPostInclude;
}>;

@Injectable()
export class HiringPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiRecommendationClient,
    private readonly payloadMapper: RecommendationPayloadMapperService,
  ) {}

  async findOpen(query: PaginationDto, viewerId?: number) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = this.buildOpenWhere(query);

    const [posts, total] = await Promise.all([
      this.prisma.hiringPost.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: hiringPostInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.hiringPost.count({ where }),
    ]);
    const appliedPostIds =
      viewerId && posts.length
        ? await this.findAppliedPostIds(
            viewerId,
            posts.map((post) => post.id),
          )
        : new Set<number>();

    return {
      message: 'Get hiring posts successfully',
      content: this.toPaginatedContent(
        posts.map((post) => this.toHiringPostCard(post, appliedPostIds)),
        total,
        page,
        pageSize,
      ),
    };
  }

  async findMine(userId: number, userRole: Role, query: PaginationDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const keyword = query.keyword?.trim();
    const filters: Prisma.HiringPostWhereInput[] = [];

    if (userRole !== Role.ADMIN) {
      filters.push({ recruiterId: userId });
    }

    if (keyword) {
      filters.push(this.keywordWhere(keyword));
    }

    const where: Prisma.HiringPostWhereInput = filters.length
      ? { AND: filters }
      : {};

    const [posts, total] = await Promise.all([
      this.prisma.hiringPost.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: hiringPostInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.hiringPost.count({ where }),
    ]);

    return {
      message: 'Get your hiring posts successfully',
      content: this.toPaginatedContent(
        posts.map((post) => this.toHiringPostCard(post)),
        total,
        page,
        pageSize,
      ),
    };
  }

  async findOne(id: number, userId: number, userRole: Role) {
    const post = await this.findPostOrThrow(id);
    if (
      post.status !== HiringPostStatus.OPEN &&
      post.recruiterId !== userId &&
      userRole !== Role.ADMIN
    ) {
      throw new ForbiddenException('You cannot view this closed hiring post');
    }

    const appliedPostIds =
      userRole === Role.USER
        ? await this.findAppliedPostIds(userId, [id])
        : new Set<number>();

    return {
      message: 'Get hiring post successfully',
      content: this.toHiringPostCard(post, appliedPostIds),
    };
  }

  async create(dto: CreateHiringPostDto, recruiterId: number) {
    this.assertSalaryRange(dto.salaryMin, dto.salaryMax);

    const post = await this.prisma.hiringPost.create({
      data: {
        recruiterId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        requirements: this.optionalTrim(dto.requirements),
        location: this.optionalTrim(dto.location),
        employmentType: this.optionalTrim(dto.employmentType),
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
      },
      include: hiringPostInclude,
    });

    return {
      message: 'Create hiring post successfully',
      content: this.toHiringPostCard(post),
    };
  }

  async update(
    id: number,
    dto: UpdateHiringPostDto,
    userId: number,
    userRole: Role,
  ) {
    const post = await this.findPostOrThrow(id);
    this.assertCanManage(post.recruiterId, userId, userRole);
    this.assertSalaryRange(
      dto.salaryMin ?? post.salaryMin ?? undefined,
      dto.salaryMax ?? post.salaryMax ?? undefined,
    );

    const updated = await this.prisma.hiringPost.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.requirements !== undefined
          ? { requirements: this.optionalTrim(dto.requirements) }
          : {}),
        ...(dto.location !== undefined
          ? { location: this.optionalTrim(dto.location) }
          : {}),
        ...(dto.employmentType !== undefined
          ? { employmentType: this.optionalTrim(dto.employmentType) }
          : {}),
        ...(dto.salaryMin !== undefined ? { salaryMin: dto.salaryMin } : {}),
        ...(dto.salaryMax !== undefined ? { salaryMax: dto.salaryMax } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: hiringPostInclude,
    });

    return {
      message: 'Update hiring post successfully',
      content: this.toHiringPostCard(updated),
    };
  }

  async remove(id: number, userId: number, userRole: Role) {
    const post = await this.findPostOrThrow(id);
    this.assertCanManage(post.recruiterId, userId, userRole);

    await this.prisma.hiringPost.delete({ where: { id } });

    return {
      message: 'Delete hiring post successfully',
    };
  }

  async predictSeniority(id: number, userId: number, userRole: Role) {
    const post = await this.findPostOrThrow(id);
    this.assertCanManage(post.recruiterId, userId, userRole);

    const prediction = await this.aiClient.predictJobSeniority({
      job: this.payloadMapper.buildHiringPostPayload(post),
    });
    const predictedAt = new Date();
    const updated = await this.prisma.hiringPost.update({
      where: { id },
      data: {
        predictedSeniority: prediction.label,
        predictedSeniorityConfidence: prediction.confidence,
        predictedSeniorityModel: prediction.model,
        predictedSeniorityMetadata: {
          probabilities: prediction.probabilities,
          features: prediction.features,
          elapsedMs: prediction.elapsed_ms,
        } as Prisma.InputJsonValue,
        predictedSeniorityAt: predictedAt,
      },
      include: hiringPostInclude,
    });

    return {
      message: 'Hiring post seniority predicted successfully',
      content: this.toHiringPostCard(updated),
    };
  }

  async apply(id: number, applicantId: number, dto: ApplyHiringPostDto) {
    const post = await this.findPostOrThrow(id);

    if (post.status !== HiringPostStatus.OPEN) {
      throw new BadRequestException('This hiring post is closed');
    }

    if (post.recruiterId === applicantId) {
      throw new BadRequestException('You cannot apply to your own hiring post');
    }

    const existing = await this.prisma.hiringApplication.findUnique({
      where: { hiringPostId_applicantId: { hiringPostId: id, applicantId } },
    });

    if (existing && existing.status !== HiringApplicationStatus.WITHDRAWN) {
      throw new BadRequestException('You already applied to this hiring post');
    }

    let application: Prisma.HiringApplicationGetPayload<{
      include: ReturnType<HiringPostsService['applicationInclude']>;
    }>;
    try {
      application = existing
        ? await this.prisma.hiringApplication.update({
            where: { id: existing.id },
            data: {
              coverLetter: this.optionalTrim(dto.coverLetter),
              status: HiringApplicationStatus.APPLIED,
            },
            include: this.applicationInclude(),
          })
        : await this.prisma.hiringApplication.create({
            data: {
              hiringPostId: id,
              applicantId,
              coverLetter: this.optionalTrim(dto.coverLetter),
            },
            include: this.applicationInclude(),
          });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('You already applied to this hiring post');
      }
      throw error;
    }

    return {
      message: 'Apply to hiring post successfully',
      content: this.toApplicationCard(application),
    };
  }

  async findApplicationsForPost(
    id: number,
    userId: number,
    userRole: Role,
    query: PaginationDto,
  ) {
    const post = await this.findPostOrThrow(id);
    this.assertCanManage(post.recruiterId, userId, userRole);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.HiringApplicationWhereInput = { hiringPostId: id };

    const [applications, total] = await Promise.all([
      this.prisma.hiringApplication.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.applicationInclude(),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.hiringApplication.count({ where }),
    ]);

    return {
      message: 'Get hiring applications successfully',
      content: this.toPaginatedContent(
        applications.map((application) => this.toApplicationCard(application)),
        total,
        page,
        pageSize,
      ),
    };
  }

  async findMyApplications(userId: number, query: PaginationDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.HiringApplicationWhereInput = { applicantId: userId };

    const [applications, total] = await Promise.all([
      this.prisma.hiringApplication.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.applicationInclude(),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.hiringApplication.count({ where }),
    ]);

    return {
      message: 'Get your hiring applications successfully',
      content: this.toPaginatedContent(
        applications.map((application) => this.toApplicationCard(application)),
        total,
        page,
        pageSize,
      ),
    };
  }

  private async findPostOrThrow(id: number): Promise<HiringPostWithMeta> {
    const post = await this.prisma.hiringPost.findUnique({
      where: { id },
      include: hiringPostInclude,
    });

    if (!post) {
      throw new NotFoundException(`Hiring post with ID ${id} not found`);
    }

    return post;
  }

  private buildOpenWhere(query: PaginationDto): Prisma.HiringPostWhereInput {
    const keyword = query.keyword?.trim();
    const filters: Prisma.HiringPostWhereInput[] = [
      { status: HiringPostStatus.OPEN },
    ];

    if (keyword) {
      filters.push(this.keywordWhere(keyword));
    }

    return { AND: filters };
  }

  private keywordWhere(keyword: string): Prisma.HiringPostWhereInput {
    return {
      OR: [
        { title: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { requirements: { contains: keyword, mode: 'insensitive' } },
        { location: { contains: keyword, mode: 'insensitive' } },
        { employmentType: { contains: keyword, mode: 'insensitive' } },
        { recruiter: { name: { contains: keyword, mode: 'insensitive' } } },
      ],
    };
  }

  private async findAppliedPostIds(
    userId: number,
    postIds: number[],
  ): Promise<Set<number>> {
    if (!postIds.length) return new Set<number>();

    const applications = await this.prisma.hiringApplication.findMany({
      where: {
        applicantId: userId,
        hiringPostId: { in: postIds },
        status: { not: HiringApplicationStatus.WITHDRAWN },
      },
      select: { hiringPostId: true },
    });
    return new Set(applications.map((application) => application.hiringPostId));
  }

  private applicationInclude() {
    return {
      hiringPost: {
        include: hiringPostInclude,
      },
      applicant: {
        select: {
          id: true,
          name: true,
          avatar: true,
          headline: true,
          bio: true,
          location: true,
          profileSkills: {
            select: { id: true, name: true, level: true, sortOrder: true },
            orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
          },
        },
      },
    } satisfies Prisma.HiringApplicationInclude;
  }

  private toHiringPostCard(
    post: HiringPostWithMeta,
    appliedPostIds = new Set<number>(),
  ) {
    const { _count, ...rest } = post;
    return {
      ...rest,
      applicationCount: _count.applications,
      viewerHasApplied: appliedPostIds.has(post.id),
    };
  }

  private toApplicationCard(
    application: Prisma.HiringApplicationGetPayload<{
      include: ReturnType<HiringPostsService['applicationInclude']>;
    }>,
  ) {
    return {
      ...application,
      hiringPost: this.toHiringPostCard(application.hiringPost),
    };
  }

  private toPaginatedContent<T>(
    data: T[],
    total: number,
    page: number,
    pageSize: number,
  ) {
    return {
      data,
      total,
      page,
      pageIndex: page,
      pageSize,
      totalRow: total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private assertCanManage(ownerId: number, userId: number, userRole: Role) {
    if (ownerId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only manage your own hiring posts');
    }
  }

  private assertSalaryRange(salaryMin?: number, salaryMax?: number) {
    if (
      salaryMin !== undefined &&
      salaryMax !== undefined &&
      salaryMin > salaryMax
    ) {
      throw new BadRequestException(
        'Minimum salary cannot be greater than maximum salary',
      );
    }
  }

  private optionalTrim(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed || null;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
