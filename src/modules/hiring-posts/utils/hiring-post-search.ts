import { BadRequestException } from '@nestjs/common';
import { HiringPostStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import {
  HiringPostQueryDto,
  HiringPostSort,
} from '../dto/hiring-post-query.dto';
import { findOccupation } from '../../occupations/utils/occupation-catalogue';

/**
 * Search, filters and sort for the public hiring posts list (GET /api/hiring-posts) and its
 * facet counts. The input was already checked by HiringPostQueryDto (trimmed, max lengths, allowed
 * values); here it only becomes Prisma "where" objects, which Prisma sends as SQL parameters.
 */

export const MAX_OCCUPATION_FACETS = 10;
export const MAX_LOCATION_OPTIONS = 50;

// @find hiring-posts results sort logic [all] — what each Sort choice orders by
/** Every order ends with id, so pages never overlap or skip a post. Salaries are not converted between units. */
export const HIRING_POST_ORDER: Record<
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

// @find hiring-posts search keyword-fields logic [all] — the fields the keyword is searched in
/**
 * The text fields the keyword is searched in: "contains, ignoring case". One line = one field;
 * delete a line to stop searching that field. Skills are searched separately (see keywordWhere).
 * Used by both lists: the public hiring posts (GET /api/hiring-posts) and My hiring posts (GET /api/hiring-posts/mine).
 */
export function keywordTextFields(
  keyword: string,
): Prisma.HiringPostWhereInput[] {
  const has = { contains: keyword, mode: 'insensitive' as const };
  return [
    { title: has },
    { description: has },
    { requirements: has },
    { location: has },
    { employmentType: has },
    { companyName: has },
    { recruiter: { name: has } },
  ];
}

// @find hiring-posts search keyword-escape logic [all] — % and _ in the keyword are matched as plain text
/** A LIKE pattern for "contains": \, % and _ are escaped so they match themselves, not "anything". */
export function containsPattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// @find hiring-posts search keyword logic [all] — keyword over the text fields plus skills
/**
 * The keyword filter: any text field above, or any skill, contains the keyword (ignoring case).
 * Prisma has no case-insensitive match on array items, so the posts whose skills match are looked
 * up first with SQL. It is a tagged template ($queryRaw`...${pattern}`), so the pattern is sent as a
 * parameter, never pasted into the SQL text (no SQL injection).
 */
export async function keywordWhere(
  prisma: PrismaService,
  keyword: string,
): Promise<Prisma.HiringPostWhereInput> {
  const pattern = containsPattern(keyword);
  const skillMatches = await prisma.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "hiring_posts"
    WHERE EXISTS (SELECT 1 FROM unnest("skills") AS skill WHERE skill ILIKE ${pattern})
  `;
  return {
    OR: [
      ...keywordTextFields(keyword),
      ...(skillMatches.length
        ? [{ id: { in: skillMatches.map((row) => row.id) } }]
        : []),
    ],
  };
}

/** The list filters a facet can leave out to count its own choices. */
export type FacetGroup =
  | 'keyword'
  | 'occupation'
  | 'level'
  | 'employmentType'
  | 'location';
export type OpenFilters = { open: Prisma.HiringPostWhereInput[] } & Partial<
  Record<FacetGroup, Prisma.HiringPostWhereInput>
>;

// @find hiring-posts filters all logic [all] — every filter of the list (open only, keyword, occupation, level, type, location)
/**
 * The open-post filters, one entry per group, so facets can leave one group out.
 * Throws 400 for an occupation code that is not in the catalogue, naming it.
 */
export async function openFilters(
  prisma: PrismaService,
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

  if (keyword) filters.keyword = await keywordWhere(prisma, keyword);
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
  // @find hiring-posts filters location logic [all] — location filter: contains, ignoring case
  if (query.location) {
    filters.location = {
      location: { contains: query.location, mode: 'insensitive' },
    };
  }
  return filters;
}

/** All filter groups joined with AND, optionally without one group (for its facet counts). */
export function combineOpenFilters(
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

// @find hiring-posts filters location-counts logic [all] — the location choices and their numbers
/**
 * Locations of the posts matching `where`, merged ignoring case and surrounding spaces, each shown in its
 * most used spelling. A count is the number of those posts whose location contains the value (ignoring case),
 * which is exactly what `?location=<value>` finds. Most posts first, then by name; at most 50.
 */
export async function locationCounts(
  prisma: PrismaService,
  where: Prisma.HiringPostWhereInput,
) {
  const groups = await prisma.hiringPost.groupBy({
    by: ['location'],
    where: { AND: [where, { location: { not: null } }] },
    _count: { _all: true },
  });
  const posts = groups.map((group) => ({
    location: (group.location ?? '').toLowerCase(),
    count: group._count._all,
  }));
  return mergeSpellings(
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
export function mergeSpellings(
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
    entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + count);
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
