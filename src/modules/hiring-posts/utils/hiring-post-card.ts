/**
 * Card-formatting helpers for the hiring-posts module. Shapes hiring posts for API responses, looks up occupation titles, counts applications per pipeline step, and attaches the viewer's application state.
 *
 * Calls: prisma.hiringApplication; findOccupation
 * Used by:
 *   - src/modules/hiring-pipeline/services/applications-query.service.ts
 *   - src/modules/hiring-posts/services/hiring-posts.service.ts
 *   - src/modules/hiring-posts/utils/hiring-post-update.ts
 */

import { HiringApplicationStatus, Prisma, PrismaClient } from '@prisma/client';
import { findOccupation } from '../../occupations/utils/occupation-catalogue';

// The hiring post "card" (the post as the app shows it), shared by the hiring posts pages and the
// application detail of the hiring pipeline, so both show the same numbers.

export const hiringPostInclude = {
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

export type HiringPostWithMeta = Prisma.HiringPostGetPayload<{
  include: typeof hiringPostInclude;
}>;

/** The application statuses counted on the owner's post card (the "pipeline"). */
export const PIPELINE_STATUSES = [
  HiringApplicationStatus.APPLIED,
  HiringApplicationStatus.REVIEWING,
  HiringApplicationStatus.INTERVIEWING,
  HiringApplicationStatus.OFFERED,
  HiringApplicationStatus.HIRED,
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
export type PipelineCounts = Record<PipelineStatus, number>;

export function emptyPipeline(): PipelineCounts {
  return { APPLIED: 0, REVIEWING: 0, INTERVIEWING: 0, OFFERED: 0, HIRED: 0 };
}

/**
 * How many applications of each post are at each pipeline step, from ONE groupBy (a single query that
 * counts rows per post and status; no query per post).
 * Every post gets all five keys; a missing one is 0.
 */
export async function pipelineCounts(
  prisma: Pick<PrismaClient, 'hiringApplication'>,
  postIds: number[],
): Promise<Map<number, PipelineCounts>> {
  const counts = new Map<number, PipelineCounts>();
  if (!postIds.length) return counts;
  const groups = await prisma.hiringApplication.groupBy({
    by: ['hiringPostId', 'status'],
    where: {
      hiringPostId: { in: postIds },
      status: { in: [...PIPELINE_STATUSES] },
    },
    _count: { _all: true },
  });
  for (const postId of postIds) counts.set(postId, emptyPipeline());
  for (const group of groups) {
    const postCounts = counts.get(group.hiringPostId);
    if (postCounts && group.status in postCounts) {
      postCounts[group.status as PipelineStatus] = group._count._all;
    }
  }
  return counts;
}

/** Why an application was ended by the system (a "sweep": the post filled or closed). */
export type ViewerStatusReason = 'POSITION_FILLED' | 'POST_CLOSED';

/** The viewer's own application to a post, as the post card shows it. */
export type ViewerApplication = {
  id: number;
  status: HiringApplicationStatus;
  statusReason: ViewerStatusReason | null;
};

/** Select this from hiringApplication to build a ViewerApplication. */
export const viewerApplicationSelect = {
  id: true,
  hiringPostId: true,
  status: true,
  statusReason: true,
} satisfies Prisma.HiringApplicationSelect;

/**
 * Turn database rows into the map the card reads (post id -> the viewer's application).
 * The database keeps statusReason as free text, so any value that is not one of the two sweep
 * reasons becomes null.
 */
export function toViewerApplications(
  rows: {
    id: number;
    hiringPostId: number;
    status: HiringApplicationStatus;
    statusReason: string | null;
  }[],
): Map<number, ViewerApplication> {
  return new Map(
    rows.map((row) => [
      row.hiringPostId,
      {
        id: row.id,
        status: row.status,
        statusReason:
          row.statusReason === 'POSITION_FILLED' ||
          row.statusReason === 'POST_CLOSED'
            ? row.statusReason
            : null,
      },
    ]),
  );
}

/**
 * The post as the app shows it. `viewerApplications` is the viewer's own application per post (empty for
 * guests): it gives viewerApplication, and viewerHasApplied is true unless that application was withdrawn
 * (a withdrawn one can be sent again). `counts` (from pipelineCounts) gives hiredCount (people hired) and
 * offersWaiting (offers not answered yet); a post missing from it shows 0 for both.
 */
export function toHiringPostCard(
  post: HiringPostWithMeta,
  viewerApplications = new Map<number, ViewerApplication>(),
  counts = new Map<number, PipelineCounts>(),
) {
  const { _count, ...rest } = post;
  const postCounts = counts.get(post.id);
  const viewerApplication = viewerApplications.get(post.id) ?? null;
  return {
    ...rest,
    occupationTitle: findOccupation(post.occupationCode)?.title ?? null,
    applicationCount: _count.applications,
    hiredCount: postCounts?.HIRED ?? 0,
    offersWaiting: postCounts?.OFFERED ?? 0,
    viewerHasApplied:
      viewerApplication !== null &&
      viewerApplication.status !== HiringApplicationStatus.WITHDRAWN,
    viewerApplication,
  };
}

export type HiringPostCard = ReturnType<typeof toHiringPostCard>;
