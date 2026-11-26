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
} from '../dto/hiring-post-query.dto';
import { PrismaService } from '../../../prisma.service';
import {
  HiringPostAiQueueService,
  queuedHiringPostFields,
} from './hiring-post-ai-queue.service';
import { ApplyHiringPostDto } from '../dto/apply-hiring-post.dto';
import { CreateHiringPostDto } from '../dto/create-hiring-post.dto';
import { UpdateHiringPostDto } from '../dto/update-hiring-post.dto';
import { PostApplicationsQueryDto } from '../dto/post-applications-query.dto';
import { findOccupation } from '../../occupations/utils/occupation-catalogue';
import {
  combineOpenFilters,
  HIRING_POST_ORDER,
  keywordWhere,
  locationCounts,
  MAX_OCCUPATION_FACETS,
  mergeSpellings,
  openFilters,
} from '../utils/hiring-post-search';
import {
  assertCanManage,
  assertClosesInFuture,
  assertSalaryRange,
  assertTakesApplications,
  isUniqueConstraintError,
  occupationChoice,
  optionalTrim,
} from '../utils/hiring-post-checks';
import {
  buildPostUpdateData,
  didLevelInputsChange,
  didLevelTextChange,
  validateUpdateInputs,
} from '../utils/hiring-post-update';
import {
  emptyPipeline,
  hiringPostInclude,
  HiringPostWithMeta,
  PipelineCounts,
  pipelineCounts,
  toHiringPostCard,
  toViewerApplications,
  ViewerApplication,
  viewerApplicationSelect,
} from '../utils/hiring-post-card';
import { HiringEventsService } from '../../hiring-pipeline/services/hiring-events.service';
import {
  interviewsInclude,
  resumeSelect,
  toResumeSummary,
} from '../../hiring-pipeline/services/applications-query.service';
import {
  PostSweepService,
  SweepReason,
} from '../../hiring-pipeline/services/post-sweep.service';

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
    const where = combineOpenFilters(await openFilters(this.prisma, query));

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
    const [viewerApplications, counts] = await Promise.all([
      viewerId && posts.length
        ? this.findViewerApplications(viewerId, postIds)
        : Promise.resolve(new Map<number, ViewerApplication>()),
      this.pipelineCounts(postIds),
    ]);

    const content = this.toPaginatedContent(
      posts.map((post) =>
        this.toHiringPostCard(post, viewerApplications, counts),
      ),
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

  async findMine(userId: number, query: PaginationDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const keyword = query.keyword?.trim();
    const filters: Prisma.HiringPostWhereInput[] = [];

    // "My hiring posts" is always the caller's own posts. Admins see every post on the admin dashboard.
    filters.push({ recruiterId: userId });

    if (keyword) {
      filters.push(await keywordWhere(this.prisma, keyword));
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

    // One groupBy (a single query that counts rows per post and status) for the whole page, so the owner
    // sees how many people are at each step.
    const counts = await this.pipelineCounts(posts.map((post) => post.id));

    return {
      message: 'Get your hiring posts successfully',
      content: this.toPaginatedContent(
        posts.map((post) => ({
          ...this.toHiringPostCard(post, undefined, counts),
          pipeline: counts.get(post.id) ?? emptyPipeline(),
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

    const [viewerApplications, counts] = await Promise.all([
      userId !== undefined && userRole === Role.USER
        ? this.findViewerApplications(userId, [id])
        : Promise.resolve(new Map<number, ViewerApplication>()),
      this.pipelineCounts([id]),
    ]);

    return {
      message: 'Get hiring post successfully',
      content: this.toHiringPostCard(post, viewerApplications, counts),
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
    assertSalaryRange(dto.salaryMin, dto.salaryMax);
    assertClosesInFuture(dto.closesAt);
    const occupation = occupationChoice(dto.occupationCode, dto.specialty);

    const post = await this.prisma.hiringPost.create({
      data: {
        recruiterId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        requirements: optionalTrim(dto.requirements),
        location: optionalTrim(dto.location),
        employmentType: optionalTrim(dto.employmentType),
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        // Not sent: the column defaults (USD, month).
        salaryCurrency: dto.salaryCurrency,
        salaryPeriod: dto.salaryPeriod,
        companyName: optionalTrim(dto.companyName),
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
    // 1. Load the post and check ownership/admin permission before validating any input fields.
    const post = await this.loadManageablePost(id, userId, userRole);
    // 2. Check salary range, closing date and occupation/specialty before opening a transaction.
    const occupation = validateUpdateInputs(post, dto);
    // 3. Decide if the AI level must be cleared or re-queued, and whether this closes an OPEN post.
    const levelInputsChanged = didLevelInputsChange(post, dto, occupation);
    const requeue = levelInputsChanged || didLevelTextChange(post, dto);
    const closing =
      dto.status === HiringPostStatus.CLOSED &&
      post.status === HiringPostStatus.OPEN;

    // 4. Save everything in one transaction: check openings/reopening under the post lock first
    //    (which may close a full post), claim a manual close if still OPEN, then write the fields.
    const { updated, swept, sweepReason } = await this.prisma.$transaction(
      async (tx) => {
        const { filled, swept, sweepReason } =
          await this.resolveOpeningsAndCloseInTx(tx, id, dto, userId, closing);
        const updated = await tx.hiringPost.update({
          where: { id },
          data: buildPostUpdateData(
            dto,
            occupation,
            filled,
            levelInputsChanged,
            requeue,
          ),
          include: hiringPostInclude,
        });
        return { updated, swept, sweepReason };
      },
    );

    // 5. After the transaction commits, wake the AI queue and notify any swept candidates.
    await this.runUpdateSideEffects(
      id,
      updated,
      userId,
      requeue,
      swept,
      sweepReason,
    );

    return {
      message: 'Update hiring post successfully',
      content: this.toHiringPostCard(
        updated,
        undefined,
        await this.pipelineCounts([id]),
      ),
    };
  }

  /** Load a post by ID and make sure the caller is its owner or an admin. */
  private async loadManageablePost(
    id: number,
    userId: number,
    userRole: Role,
  ): Promise<HiringPostWithMeta> {
    const post = await this.findPostOrThrow(id);
    assertCanManage(post.recruiterId, userId, userRole);
    return post;
  }

  /**
   * Run the openings/reopening checks under the post lock first, then claim a manual close
   * while the post is still OPEN so concurrent closes or offer acceptances only sweep once.
   */
  private async resolveOpeningsAndCloseInTx(
    tx: Prisma.TransactionClient,
    id: number,
    dto: UpdateHiringPostDto,
    userId: number,
    closing: boolean,
  ): Promise<{ filled: boolean; swept: number[]; sweepReason: SweepReason }> {
    const fill = await this.checkOpenings(tx, id, dto, userId);
    let swept = fill.swept;
    const sweepReason: SweepReason = fill.filled
      ? 'POSITION_FILLED'
      : 'POST_CLOSED';
    if (closing) {
      const claimed = await tx.hiringPost.updateMany({
        where: { id, status: HiringPostStatus.OPEN },
        data: { status: HiringPostStatus.CLOSED },
      });
      if (claimed.count === 1) {
        swept = await this.sweeper.sweep(tx, id, 'POST_CLOSED', userId);
      }
    }
    return { filled: fill.filled, swept, sweepReason };
  }

  /** Run post-commit notifications and AI queue wakeup after an update succeeds. */
  private async runUpdateSideEffects(
    postId: number,
    updated: HiringPostWithMeta,
    userId: number,
    requeue: boolean,
    swept: number[],
    sweepReason: SweepReason,
  ): Promise<void> {
    if (requeue) this.aiQueue.kick();
    if (!swept.length) return;
    await this.sweeper.announceSwept(this.prisma, {
      postId,
      postTitle: updated.title,
      reason: sweepReason,
      actorId: userId,
      actorName: updated.recruiter.name,
      candidateIds: swept,
    });
  }

  /**
   * The openings rules of an edit, run inside the edit's transaction. Only when the edit sends a number of
   * openings, or asks to (re)open the post:
   *  1. Lock the post row first (SELECT ... FOR UPDATE = "this row is mine until the transaction ends").
   *     Accepting an offer and closing the post also take the post row first, so the counts below cannot
   *     change while we decide, and everyone takes the locks in the same order (no "deadlock", where two
   *     requests wait for each other forever).
   *  2. Openings may not go below the people already HIRED plus those with an offer waiting (OFFERED): 409.
   *  3. A CLOSED post that is already full (hired >= openings) cannot be reopened: 409.
   *  4. If the new openings equal the hires exactly (no offer waiting) on an OPEN post, the post is full:
   *     it closes now and is swept with POSITION_FILLED, the same as when the last offer is accepted.
   * Returns whether the post was filled and the candidates swept (to tell after commit).
   */
  private async checkOpenings(
    tx: Prisma.TransactionClient,
    id: number,
    dto: UpdateHiringPostDto,
    userId: number,
  ): Promise<{ filled: boolean; swept: number[] }> {
    const newOpenings = typeof dto.openings === 'number' ? dto.openings : null;
    const reopening = dto.status === HiringPostStatus.OPEN;
    if (newOpenings === null && !reopening) return { filled: false, swept: [] };

    await tx.$queryRaw`SELECT id FROM "hiring_posts" WHERE id = ${id} FOR UPDATE`;
    // Read the post again after the lock: this is the latest status and openings.
    const locked = await tx.hiringPost.findUnique({
      where: { id },
      select: { status: true, openings: true },
    });
    if (!locked) {
      throw new NotFoundException(`Hiring post with ID ${id} not found`);
    }
    const [hired, offered] = await Promise.all([
      tx.hiringApplication.count({
        where: { hiringPostId: id, status: HiringApplicationStatus.HIRED },
      }),
      tx.hiringApplication.count({
        where: { hiringPostId: id, status: HiringApplicationStatus.OFFERED },
      }),
    ]);

    const taken = hired + offered;
    if (newOpenings !== null && newOpenings < taken) {
      const who =
        taken === 1
          ? '1 person is hired or has an offer waiting'
          : `${taken} people are hired or have an offer waiting`;
      throw new ConflictException(
        `${who}, so openings cannot be fewer than ${taken}.`,
      );
    }

    const openings =
      dto.openings !== undefined ? dto.openings : locked.openings;
    if (
      reopening &&
      locked.status === HiringPostStatus.CLOSED &&
      openings !== null &&
      hired >= openings
    ) {
      throw new ConflictException(
        'This post is already filled. Raise the openings to reopen it.',
      );
    }

    const filled =
      newOpenings !== null &&
      newOpenings === hired &&
      locked.status === HiringPostStatus.OPEN;
    if (!filled) return { filled: false, swept: [] };
    await tx.hiringPost.update({
      where: { id },
      data: { status: HiringPostStatus.CLOSED },
    });
    const swept = await this.sweeper.sweep(tx, id, 'POSITION_FILLED', userId);
    return { filled: true, swept };
  }

  async remove(id: number, userId: number, userRole: Role) {
    const post = await this.findPostOrThrow(id);
    assertCanManage(post.recruiterId, userId, userRole);

    await this.prisma.hiringPost.delete({ where: { id } });

    return {
      message: 'Delete hiring post successfully',
    };
  }

  async predictSeniority(id: number, userId: number, userRole: Role) {
    const post = await this.findPostOrThrow(id);
    assertCanManage(post.recruiterId, userId, userRole);

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

    assertTakesApplications(post);

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
        // Join the post lock first. FOR SHARE (a "read lock") lets many candidates apply at the same time,
        // but waits while a recruiter closes the post or fills it (they hold FOR UPDATE, a "write lock").
        // So an application can never slip in after a close has swept the post.
        await tx.$queryRaw`SELECT id, status FROM "hiring_posts" WHERE id = ${id} FOR SHARE`;
        const current = await tx.hiringPost.findUnique({
          where: { id },
          select: { status: true, closesAt: true },
        });
        if (!current) {
          throw new NotFoundException(`Hiring post with ID ${id} not found`);
        }
        assertTakesApplications(current);
        const saved = existing
          ? await tx.hiringApplication.update({
              where: { id: existing.id },
              data: {
                coverLetter: optionalTrim(dto.coverLetter),
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
                coverLetter: optionalTrim(dto.coverLetter),
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
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('You already applied to this hiring post');
      }
      throw error;
    }

    // After commit: tell the recruiter. announce() never throws.
    await this.events.announce({
      recipientId: post.recruiterId,
      actorId: applicantId,
      actorName: application.applicant.name,
      kind: 'received',
      title: 'New applicant',
      body: `${application.applicant.name} applied for ${post.title}.`,
      applicationId: application.id,
      postId: id,
      postTitle: post.title,
      forRecruiter: true,
    });

    return {
      message: 'Apply to hiring post successfully',
      content: this.toApplicationCard(
        application,
        await this.pipelineCounts([id]),
        toViewerApplications([application]),
      ),
    };
  }

  /**
   * The recruiter's applicants page: one page of the post's applications (only `status` ones when given),
   * plus `counts`, how many applications the post has in each of the 8 statuses (for the tabs).
   * One groupBy (a single query that counts rows per status) gives `counts` and the post card's numbers.
   */
  async findApplicationsForPost(
    id: number,
    userId: number,
    userRole: Role,
    query: PostApplicationsQueryDto,
  ) {
    const post = await this.findPostOrThrow(id);
    assertCanManage(post.recruiterId, userId, userRole);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.HiringApplicationWhereInput = {
      hiringPostId: id,
      ...(query.status ? { status: query.status } : {}),
    };

    const [applications, total, groups] = await Promise.all([
      this.prisma.hiringApplication.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.applicantsListInclude(),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.hiringApplication.count({ where }),
      this.prisma.hiringApplication.groupBy({
        by: ['status'],
        where: { hiringPostId: id },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(
      Object.values(HiringApplicationStatus).map((status) => [status, 0]),
    ) as Record<HiringApplicationStatus, number>;
    for (const group of groups) counts[group.status] = group._count._all;
    const cardCounts = new Map<number, PipelineCounts>([
      [
        id,
        {
          APPLIED: counts.APPLIED,
          REVIEWING: counts.REVIEWING,
          INTERVIEWING: counts.INTERVIEWING,
          OFFERED: counts.OFFERED,
          HIRED: counts.HIRED,
        },
      ],
    ]);

    return {
      message: 'Get hiring applications successfully',
      content: {
        ...this.toPaginatedContent(
          applications.map((application) => {
            // The raw resume stays out of the row; the row carries the same summary as the detail page.
            const { resume, ...applicant } = application.applicant;
            return {
              ...this.toApplicationCard(
                { ...application, applicant },
                cardCounts,
              ),
              resume: toResumeSummary(resume, applicant.profileSkills),
            };
          }),
          total,
          page,
          pageSize,
        ),
        counts,
      },
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
        // Interviews come in the same query so the list can flag "Action needed" and show the next time.
        include: {
          ...this.applicationInclude(),
          interviews: interviewsInclude,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.hiringApplication.count({ where }),
    ]);
    const counts = await this.pipelineCounts([
      ...new Set(applications.map((application) => application.hiringPostId)),
    ]);
    // These are the user's own applications; a withdrawn one can be sent again, so it does not count
    // as "applied" (the same rule as the post list).
    const viewerApplications = toViewerApplications(applications);

    return {
      message: 'Get your hiring applications successfully',
      content: this.toPaginatedContent(
        applications.map((application) =>
          this.toApplicationCard(application, counts, viewerApplications),
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
    const where = combineOpenFilters(await openFilters(this.prisma, {}));
    return {
      message: 'Get hiring post locations successfully',
      content: await locationCounts(this.prisma, where),
    };
  }

  /**
   * How many open posts each filter choice would find. Each group is counted with every other filter applied
   * but not its own, so the numbers say what ticking one more box in that group would give.
   * Same query as the list; page, pageSize and sort are ignored.
   */
  async findFacets(query: HiringPostQueryDto) {
    const filters = await openFilters(this.prisma, query);
    const [occupationGroups, levelGroups, employmentTypeGroups, locations] =
      await Promise.all([
        this.prisma.hiringPost.groupBy({
          by: ['occupationCode'],
          where: {
            AND: [
              combineOpenFilters(filters, 'occupation'),
              { occupationCode: { not: null } },
            ],
          },
          _count: { _all: true },
        }),
        this.prisma.hiringPost.groupBy({
          by: ['predictedSeniority'],
          where: combineOpenFilters(filters, 'level'),
          _count: { _all: true },
        }),
        this.prisma.hiringPost.groupBy({
          by: ['employmentType'],
          where: combineOpenFilters(filters, 'employmentType'),
          _count: { _all: true },
        }),
        locationCounts(this.prisma, combineOpenFilters(filters, 'location')),
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
    const employmentTypes = mergeSpellings(
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
   * The viewer's own application to each of these posts, from ONE query (no query per card).
   * A withdrawn application is included (its status says WITHDRAWN); the card works out viewerHasApplied.
   */
  private async findViewerApplications(
    userId: number,
    postIds: number[],
  ): Promise<Map<number, ViewerApplication>> {
    if (!postIds.length) return new Map<number, ViewerApplication>();

    const applications = await this.prisma.hiringApplication.findMany({
      where: { applicantId: userId, hiringPostId: { in: postIds } },
      select: viewerApplicationSelect,
    });
    return toViewerApplications(applications);
  }

  private pipelineCounts(postIds: number[]) {
    return pipelineCounts(this.prisma, postIds);
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
   * What each row of the recruiter's applicants list loads, in the same findMany (no query per row):
   * the usual card parts plus the resume columns (for the summary) and the interviews (round 1 first).
   */
  private applicantsListInclude() {
    const base = this.applicationInclude();
    return {
      ...base,
      applicant: {
        select: {
          ...base.applicant.select,
          resume: { select: resumeSelect },
        },
      },
      interviews: interviewsInclude,
    } satisfies Prisma.HiringApplicationInclude;
  }

  private toHiringPostCard(
    post: HiringPostWithMeta,
    viewerApplications?: Map<number, ViewerApplication>,
    counts?: Map<number, PipelineCounts>,
  ) {
    return toHiringPostCard(post, viewerApplications, counts);
  }

  private toApplicationCard(
    application: Prisma.HiringApplicationGetPayload<{
      include: ReturnType<HiringPostsService['applicationInclude']>;
    }>,
    counts?: Map<number, PipelineCounts>,
    /** The viewer's own applications by post (only for the applicant's own cards; recruiters pass none). */
    viewerApplications?: Map<number, ViewerApplication>,
  ) {
    return {
      ...application,
      hiringPost: this.toHiringPostCard(
        application.hiringPost,
        viewerApplications,
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
}
