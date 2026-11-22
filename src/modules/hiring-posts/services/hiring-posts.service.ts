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
import {
  HIRING_POST_LEVELS,
  HiringPostQueryDto,
  MAX_HIRING_POST_PAGE,
  HiringPostSort,
} from '../dto/hiring-post-query.dto';
import { PrismaService } from '../../../prisma.service';
import {
  HiringPostAiQueueService,
  queuedHiringPostFields,
} from './hiring-post-ai-queue.service';
import { ApplyHiringPostDto } from '../dto/apply-hiring-post.dto';
import { CreateHiringPostDto } from '../dto/create-hiring-post.dto';
import { UpdateHiringPostDto } from '../dto/update-hiring-post.dto';
import { findOccupation } from '../../occupations/occupation-catalogue';
import { HiringEventsService } from '../../hiring-pipeline/hiring-events.service';
import { PostSweepService } from '../../hiring-pipeline/post-sweep.service';

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

/** The list filters a facet can leave out to count its own choices. */
type FacetGroup =
  | 'keyword'
  | 'occupation'
  | 'level'
  | 'employmentType'
  | 'location';
type OpenFilters = { open: Prisma.HiringPostWhereInput[] } & Partial<
  Record<FacetGroup, Prisma.HiringPostWhereInput>
>;

/** The application statuses counted on the owner's post card (the "pipeline"). */
const PIPELINE_STATUSES = [
  HiringApplicationStatus.APPLIED,
  HiringApplicationStatus.REVIEWING,
  HiringApplicationStatus.INTERVIEWING,
  HiringApplicationStatus.OFFERED,
  HiringApplicationStatus.HIRED,
] as const;
type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
type PipelineCounts = Record<PipelineStatus, number>;

const MAX_OCCUPATION_FACETS = 10;
const MAX_LOCATION_OPTIONS = 50;

/** Every order ends with id, so pages never overlap or skip a post. Salaries are not converted between units. */
const HIRING_POST_ORDER: Record<
  HiringPostSort,
  Prisma.HiringPostOrderByWithRelationInput[]
> = {
  newest: [{ updatedAt: 'desc' }, { id: 'desc' }],
  closing_soon: [{ closesAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
  salary_high: [
    { salaryMax: { sort: 'desc', nulls: 'last' } },
    { salaryMin: { sort: 'desc', nulls: 'last' } },
    { id: 'desc' },
  ],
};

@Injectable()
export class HiringPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiQueue: HiringPostAiQueueService,
    private readonly events: HiringEventsService,
    private readonly sweeper: PostSweepService,
  ) {}

  async findOpen(query: HiringPostQueryDto, viewerId?: number) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = this.combineOpenFilters(await this.openFilters(query));

    const [posts, total] = await Promise.all([
      this.prisma.hiringPost.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: hiringPostInclude,
        orderBy: HIRING_POST_ORDER[query.sort ?? 'newest'],
      }),
      this.prisma.hiringPost.count({ where }),
    ]);
    const postIds = posts.map((post) => post.id);
    const [appliedPostIds, counts] = await Promise.all([
      viewerId && posts.length
        ? this.findAppliedPostIds(viewerId, postIds)
        : Promise.resolve(new Set<number>()),
      this.pipelineCounts(postIds),
    ]);

    const content = this.toPaginatedContent(
      posts.map((post) => this.toHiringPostCard(post, appliedPostIds, counts)),
      total,
      page,
      pageSize,
    );
    return {
      message: 'Get hiring posts successfully',
      // totalRow stays the real number of posts; only the pages that can be opened are counted.
      content: {
        ...content,
        totalPages: Math.min(content.totalPages, MAX_HIRING_POST_PAGE),
      },
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
      filters.push(await this.keywordWhere(keyword));
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

    // One groupBy for the whole page, so the owner sees how many people are at each step.
    const counts = await this.pipelineCounts(posts.map((post) => post.id));

    return {
      message: 'Get your hiring posts successfully',
      content: this.toPaginatedContent(
        posts.map((post) => ({
          ...this.toHiringPostCard(post, undefined, counts),
          pipeline: counts.get(post.id) ?? this.emptyPipeline(),
        })),
        total,
        page,
        pageSize,
      ),
    };
  }

  async findOne(id: number, userId?: number, userRole?: Role) {
    const post = await this.findPostOrThrow(id);
    if (
      post.status !== HiringPostStatus.OPEN &&
      post.recruiterId !== userId &&
      userRole !== Role.ADMIN
    ) {
      throw new ForbiddenException('You cannot view this closed hiring post');
    }

    const [appliedPostIds, counts] = await Promise.all([
      userId !== undefined && userRole === Role.USER
        ? this.findAppliedPostIds(userId, [id])
        : Promise.resolve(new Set<number>()),
      this.pipelineCounts([id]),
    ]);

    return {
      message: 'Get hiring post successfully',
      content: this.toHiringPostCard(post, appliedPostIds, counts),
    };
  }

  /**
   * HIRING POST FLOW, step 1: a recruiter creates a post.
   *  1. Check the input: salary min ≤ max, closing date in the future, and the occupation is a real ESCO
   *     occupation (with a specialty that belongs to it).
   *     `dto` = Data Transfer Object: the request body, already checked by its class rules (class-validator).
   *  2. Save the post with aiStatus = QUEUED.
   *  3. kick() wakes the AI queue (hiring-post-ai-queue.service.ts), which later saves the AI level.
   * The recruiter gets an answer at once; the AI level appears on the post when the queue has finished.
   */
  async create(dto: CreateHiringPostDto, recruiterId: number) {
    this.assertSalaryRange(dto.salaryMin, dto.salaryMax);
    this.assertClosesInFuture(dto.closesAt);
    const occupation = this.occupationChoice(dto.occupationCode, dto.specialty);

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
        // Not sent: the column defaults (USD, month).
        salaryCurrency: dto.salaryCurrency,
        salaryPeriod: dto.salaryPeriod,
        companyName: this.optionalTrim(dto.companyName),
        occupationCode: occupation.code,
        specialty: occupation.specialty,
        yearsRequired: dto.yearsRequired,
        skills: dto.skills ?? [],
        // Not sent: 1 person. null is kept: no limit ("keep hiring until I close the post").
        openings: dto.openings === undefined ? 1 : dto.openings,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : null,
        // The AI level is worked out by the queue, never while saving.
        ...queuedHiringPostFields(),
      },
      include: hiringPostInclude,
    });
    this.aiQueue.kick();

    return {
      message: 'Create hiring post successfully',
      content: this.toHiringPostCard(post),
    };
  }

  /**
   * Edit a post. Only the owner (or an admin) may. Fields not sent stay as they are.
   * If something the AI reads changed (occupation, years, skills, title, description, requirements), the post
   * goes back into the AI queue; if the occupation, years or skills changed, the old level is cleared first,
   * because it no longer describes the post.
   * Closing an OPEN post also "sweeps" it (PostSweepService): every application still in progress is
   * rejected with reason POST_CLOSED, in the same transaction as the close; the candidates are told after
   * the transaction is saved. Editing a post that is already closed, or reopening it, sweeps nothing.
   */
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
    this.assertClosesInFuture(dto.closesAt);
    // A changed occupation drops the stored specialty unless a new one is sent; a sent specialty is checked
    // against the occupation the post will have.
    // An empty specialty on a post that has no occupation yet (an old post) changes nothing.
    const occupationSent =
      dto.occupationCode !== undefined ||
      (dto.specialty !== undefined &&
        (post.occupationCode !== null ||
          this.optionalTrim(dto.specialty) !== null));
    const occupation = occupationSent
      ? this.occupationChoice(
          dto.occupationCode ?? post.occupationCode,
          dto.specialty !== undefined
            ? dto.specialty
            : (dto.occupationCode ?? post.occupationCode) ===
                post.occupationCode
              ? post.specialty
              : null,
        )
      : null;
    // A new occupation, required years or skill list means the saved AI level no longer describes the post.
    const levelInputsChanged =
      (occupation !== null && occupation.code !== post.occupationCode) ||
      (dto.yearsRequired !== undefined &&
        dto.yearsRequired !== post.yearsRequired) ||
      (dto.skills !== undefined &&
        JSON.stringify(dto.skills) !== JSON.stringify(post.skills));
    // The AI also reads the title and text, so a change there asks for a fresh level too.
    const levelTextChanged =
      (dto.title !== undefined && dto.title.trim() !== post.title) ||
      (dto.description !== undefined &&
        dto.description.trim() !== post.description) ||
      (dto.requirements !== undefined &&
        (this.optionalTrim(dto.requirements) ?? null) !==
          (post.requirements ?? null));
    const requeue = levelInputsChanged || levelTextChanged;
    const closing =
      dto.status === HiringPostStatus.CLOSED &&
      post.status === HiringPostStatus.OPEN;

    // One transaction (a group of changes saved together or not at all) for the edit and the sweep.
    const { updated, swept } = await this.prisma.$transaction(async (tx) => {
      let swept: number[] = [];
      if (closing) {
        // Claim the close only while the post is still OPEN; the row lock this takes makes a second
        // close (or an offer being accepted) wait, so the sweep runs once.
        const claimed = await tx.hiringPost.updateMany({
          where: { id, status: HiringPostStatus.OPEN },
          data: { status: HiringPostStatus.CLOSED },
        });
        if (claimed.count === 1) {
          swept = await this.sweeper.sweep(tx, id, 'POST_CLOSED', userId);
        }
      }
      const updated = await tx.hiringPost.update({
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
          ...(dto.salaryCurrency !== undefined
            ? { salaryCurrency: dto.salaryCurrency }
            : {}),
          ...(dto.salaryPeriod !== undefined
            ? { salaryPeriod: dto.salaryPeriod }
            : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.companyName !== undefined
            ? { companyName: this.optionalTrim(dto.companyName) }
            : {}),
          ...(occupation !== null
            ? {
                occupationCode: occupation.code,
                specialty: occupation.specialty,
              }
            : {}),
          ...(dto.yearsRequired !== undefined
            ? { yearsRequired: dto.yearsRequired }
            : {}),
          ...(dto.skills !== undefined ? { skills: dto.skills } : {}),
          ...(dto.openings !== undefined ? { openings: dto.openings } : {}),
          ...(dto.closesAt !== undefined
            ? { closesAt: new Date(dto.closesAt) }
            : {}),
          ...(levelInputsChanged
            ? {
                predictedSeniority: null,
                predictedSeniorityConfidence: null,
                predictedSeniorityModel: null,
                predictedSeniorityMetadata: Prisma.DbNull,
                predictedSeniorityAt: null,
              }
            : {}),
          ...(requeue ? queuedHiringPostFields() : {}),
        },
        include: hiringPostInclude,
      });
      return { updated, swept };
    });
    if (requeue) this.aiQueue.kick();
    if (swept.length) {
      await this.sweeper.announceSwept(this.prisma, {
        postId: id,
        postTitle: updated.title,
        reason: 'POST_CLOSED',
        actorId: userId,
        candidateIds: swept,
      });
    }

    return {
      message: 'Update hiring post successfully',
      content: this.toHiringPostCard(
        updated,
        undefined,
        await this.pipelineCounts([id]),
      ),
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

    // The level is worked out by the queue; this puts the post (back) in it, e.g. after "Try again".
    await this.aiQueue.enqueue(id);
    const queued = await this.findPostOrThrow(id);

    return {
      message: 'Hiring post queued for AI evaluation',
      content: this.toHiringPostCard(
        queued,
        undefined,
        await this.pipelineCounts([id]),
      ),
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
      // The application and its history row are saved together (one transaction).
      application = await this.prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.hiringApplication.update({
              where: { id: existing.id },
              data: {
                coverLetter: this.optionalTrim(dto.coverLetter),
                status: HiringApplicationStatus.APPLIED,
                // A fresh start: nothing from the earlier round stays.
                statusReason: null,
                statusNote: null,
                offerNote: null,
                offeredAt: null,
                decidedAt: null,
              },
              include: this.applicationInclude(),
            })
          : await tx.hiringApplication.create({
              data: {
                hiringPostId: id,
                applicantId,
                coverLetter: this.optionalTrim(dto.coverLetter),
              },
              include: this.applicationInclude(),
            });
        await this.events.record(tx, {
          applicationId: saved.id,
          actorId: applicantId,
          type: existing ? 'reapplied' : 'applied',
        });
        return saved;
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('You already applied to this hiring post');
      }
      throw error;
    }

    // After commit: tell the recruiter. announce() never throws.
    await this.events.announce({
      recipientId: post.recruiterId,
      actorId: applicantId,
      kind: 'received',
      title: 'New applicant',
      body: `${application.applicant.name} applied for ${post.title}.`,
      applicationId: application.id,
      postId: id,
      forRecruiter: true,
    });

    return {
      message: 'Apply to hiring post successfully',
      content: this.toApplicationCard(
        application,
        await this.pipelineCounts([id]),
      ),
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
    const counts = await this.pipelineCounts([id]);

    return {
      message: 'Get hiring applications successfully',
      content: this.toPaginatedContent(
        applications.map((application) =>
          this.toApplicationCard(application, counts),
        ),
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
    const counts = await this.pipelineCounts([
      ...new Set(applications.map((application) => application.hiringPostId)),
    ]);

    return {
      message: 'Get your hiring applications successfully',
      content: this.toPaginatedContent(
        applications.map((application) =>
          this.toApplicationCard(application, counts),
        ),
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

  /**
   * Locations of the open posts for the "All locations" dropdown, with how many posts each one finds.
   * A count is what `?location=<value>` returns (the filter is "contains, ignoring case"), so "Da Nang" also
   * counts posts in "Da Nang, Vietnam"; the counts can therefore add up to more than the number of posts.
   */
  async findLocations() {
    const where = this.combineOpenFilters(await this.openFilters({}));
    return {
      message: 'Get hiring post locations successfully',
      content: await this.locationCounts(where),
    };
  }

  /**
   * How many open posts each filter choice would find. Each group is counted with every other filter applied
   * but not its own, so the numbers say what ticking one more box in that group would give.
   * Same query as the list; page, pageSize and sort are ignored.
   */
  async findFacets(query: HiringPostQueryDto) {
    const filters = await this.openFilters(query);
    const [occupationGroups, levelGroups, employmentTypeGroups, locations] =
      await Promise.all([
        this.prisma.hiringPost.groupBy({
          by: ['occupationCode'],
          where: {
            AND: [
              this.combineOpenFilters(filters, 'occupation'),
              { occupationCode: { not: null } },
            ],
          },
          _count: { _all: true },
        }),
        this.prisma.hiringPost.groupBy({
          by: ['predictedSeniority'],
          where: this.combineOpenFilters(filters, 'level'),
          _count: { _all: true },
        }),
        this.prisma.hiringPost.groupBy({
          by: ['employmentType'],
          where: this.combineOpenFilters(filters, 'employmentType'),
          _count: { _all: true },
        }),
        this.locationCounts(this.combineOpenFilters(filters, 'location')),
      ]);

    const occupations = occupationGroups
      .map((group) => {
        const occupation = findOccupation(group.occupationCode);
        return occupation
          ? {
              code: occupation.code,
              title: occupation.title,
              count: group._count._all,
            }
          : null;
      })
      .filter((item) => item !== null)
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
      .slice(0, MAX_OCCUPATION_FACETS);

    const levels = HIRING_POST_LEVELS.map((level) => ({
      value: level,
      count:
        levelGroups.find((group) => group.predictedSeniority === level)?._count
          ._all ?? 0,
    }));

    // employmentType is matched "equals, ignoring case", so spellings that differ only in case are one choice.
    const employmentTypes = this.mergeSpellings(
      employmentTypeGroups.map((group) => ({
        value: group.employmentType,
        count: group._count._all,
      })),
    ).map(({ value, count }) => ({ value, count }));

    return {
      message: 'Get hiring post facets successfully',
      content: { occupations, levels, employmentTypes, locations },
    };
  }

  /**
   * The open-post filters, one entry per group, so facets can leave one group out.
   * Throws 400 for an occupation code that is not in the catalogue, naming it.
   */
  private async openFilters(
    query: Partial<HiringPostQueryDto>,
  ): Promise<OpenFilters> {
    const keyword = query.keyword?.trim();
    const filters: OpenFilters = {
      open: [
        { status: HiringPostStatus.OPEN },
        // A post past its closing date is no longer open, even before anyone closes it.
        { OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }] },
      ],
    };

    if (keyword) filters.keyword = await this.keywordWhere(keyword);
    if (query.occupation?.length) {
      const unknown = query.occupation.filter((code) => !findOccupation(code));
      if (unknown.length) {
        throw new BadRequestException(
          `Choose the occupation from the list. Unknown occupation: ${unknown.join(', ')}`,
        );
      }
      filters.occupation = {
        occupationCode: {
          in: query.occupation.map((code) => findOccupation(code)!.code),
        },
      };
    }
    if (query.level?.length) {
      filters.level = { predictedSeniority: { in: query.level } };
    }
    if (query.employmentType?.length) {
      filters.employmentType = {
        OR: query.employmentType.map((type) => ({
          employmentType: { equals: type, mode: 'insensitive' as const },
        })),
      };
    }
    if (query.location) {
      filters.location = {
        location: { contains: query.location, mode: 'insensitive' },
      };
    }
    return filters;
  }

  private combineOpenFilters(
    filters: OpenFilters,
    without?: FacetGroup,
  ): Prisma.HiringPostWhereInput {
    const { open, ...groups } = filters;
    return {
      AND: [
        ...open,
        ...Object.entries(groups)
          .filter(([group, where]) => group !== without && where)
          .map(([, where]) => where),
      ],
    };
  }

  /**
   * Locations of the posts matching `where`, merged ignoring case and surrounding spaces, each shown in its
   * most used spelling. A count is the number of those posts whose location contains the value (ignoring case),
   * which is exactly what `?location=<value>` finds. Most posts first, then by name; at most 50.
   */
  private async locationCounts(where: Prisma.HiringPostWhereInput) {
    const groups = await this.prisma.hiringPost.groupBy({
      by: ['location'],
      where: { AND: [where, { location: { not: null } }] },
      _count: { _all: true },
    });
    const posts = groups.map((group) => ({
      location: (group.location ?? '').toLowerCase(),
      count: group._count._all,
    }));
    return this.mergeSpellings(
      groups.map((group) => ({
        value: group.location,
        count: group._count._all,
      })),
    )
      .map(({ value, key }) => ({
        value,
        count: posts
          .filter((post) => post.location.includes(key))
          .reduce((sum, post) => sum + post.count, 0),
      }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, MAX_LOCATION_OPTIONS);
  }

  /**
   * Values that differ only in case or surrounding spaces become one, shown in the spelling most posts use
   * (ties: alphabetical). Empty values are dropped. Sorted by count, then name.
   */
  private mergeSpellings(
    values: { value: string | null; count: number }[],
  ): { key: string; value: string; count: number }[] {
    const merged = new Map<
      string,
      { count: number; spellings: Map<string, number> }
    >();
    for (const { value, count } of values) {
      const spelling = value?.trim();
      if (!spelling) continue;
      const key = spelling.toLowerCase();
      const entry = merged.get(key) ?? { count: 0, spellings: new Map() };
      entry.count += count;
      entry.spellings.set(
        spelling,
        (entry.spellings.get(spelling) ?? 0) + count,
      );
      merged.set(key, entry);
    }
    return [...merged.entries()]
      .map(([key, entry]) => ({
        key,
        count: entry.count,
        value: [...entry.spellings.entries()].sort(
          ([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b),
        )[0][0],
      }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  /**
   * Keyword search over the post text, location, employment type, company, recruiter name and skills.
   * A skill matches when one of the post's skills contains the keyword, ignoring case ("selenium" finds
   * "Selenium"). Prisma has no case-insensitive match on array items, so those posts are looked up first.
   */
  private async keywordWhere(
    keyword: string,
  ): Promise<Prisma.HiringPostWhereInput> {
    const pattern = `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const skillMatches = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "hiring_posts"
      WHERE EXISTS (SELECT 1 FROM unnest("skills") AS skill WHERE skill ILIKE ${pattern})
    `;
    return {
      OR: [
        { title: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { requirements: { contains: keyword, mode: 'insensitive' } },
        { location: { contains: keyword, mode: 'insensitive' } },
        { employmentType: { contains: keyword, mode: 'insensitive' } },
        { companyName: { contains: keyword, mode: 'insensitive' } },
        { recruiter: { name: { contains: keyword, mode: 'insensitive' } } },
        ...(skillMatches.length
          ? [{ id: { in: skillMatches.map((row) => row.id) } }]
          : []),
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

  /**
   * How many applications of each post are at each pipeline step, from ONE groupBy (no query per post).
   * Every post gets all five keys; a missing one is 0.
   */
  private async pipelineCounts(
    postIds: number[],
  ): Promise<Map<number, PipelineCounts>> {
    const counts = new Map<number, PipelineCounts>();
    if (!postIds.length) return counts;
    const groups = await this.prisma.hiringApplication.groupBy({
      by: ['hiringPostId', 'status'],
      where: {
        hiringPostId: { in: postIds },
        status: { in: [...PIPELINE_STATUSES] },
      },
      _count: { _all: true },
    });
    for (const postId of postIds) counts.set(postId, this.emptyPipeline());
    for (const group of groups) {
      const postCounts = counts.get(group.hiringPostId);
      if (postCounts && group.status in postCounts) {
        postCounts[group.status as PipelineStatus] = group._count._all;
      }
    }
    return counts;
  }

  private emptyPipeline(): PipelineCounts {
    return { APPLIED: 0, REVIEWING: 0, INTERVIEWING: 0, OFFERED: 0, HIRED: 0 };
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

  /**
   * The post as the app shows it. `counts` (from pipelineCounts) gives hiredCount (people hired) and
   * offersWaiting (offers not answered yet); a post missing from it shows 0 for both.
   */
  private toHiringPostCard(
    post: HiringPostWithMeta,
    appliedPostIds = new Set<number>(),
    counts = new Map<number, PipelineCounts>(),
  ) {
    const { _count, ...rest } = post;
    const postCounts = counts.get(post.id);
    return {
      ...rest,
      occupationTitle: findOccupation(post.occupationCode)?.title ?? null,
      applicationCount: _count.applications,
      hiredCount: postCounts?.HIRED ?? 0,
      offersWaiting: postCounts?.OFFERED ?? 0,
      viewerHasApplied: appliedPostIds.has(post.id),
    };
  }

  private toApplicationCard(
    application: Prisma.HiringApplicationGetPayload<{
      include: ReturnType<HiringPostsService['applicationInclude']>;
    }>,
    counts?: Map<number, PipelineCounts>,
  ) {
    return {
      ...application,
      hiringPost: this.toHiringPostCard(
        application.hiringPost,
        undefined,
        counts,
      ),
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

  private assertClosesInFuture(closesAt?: string) {
    if (closesAt !== undefined && new Date(closesAt).getTime() <= Date.now()) {
      throw new BadRequestException('The closing date must be in the future');
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

  /**
   * The occupation and specialty to store, checked against the catalogue (as resumes are): 400 for an unknown
   * occupation, or a specialty that is not listed under it.
   */
  private occupationChoice(
    code: string | null | undefined,
    specialty: string | null | undefined,
  ): { code: string; specialty: string | null } {
    const occupation = findOccupation(code);
    const chosenSpecialty = this.optionalTrim(specialty);
    if (!occupation) {
      throw new BadRequestException(
        code
          ? 'Choose the occupation from the list.'
          : 'Choose the occupation before its specialty.',
      );
    }
    if (
      chosenSpecialty !== null &&
      !occupation.specialties.includes(chosenSpecialty)
    ) {
      throw new BadRequestException(
        'Choose a specialty listed under the occupation.',
      );
    }
    return { code: occupation.code, specialty: chosenSpecialty };
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
