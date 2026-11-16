import {
  findOccupation,
  occupationRelatedness,
} from '../../occupations/occupation-catalogue';

/**
 * A job entry from the resume form: months are "YYYY-MM"; a current job has no end month. `occupation` is an ESCO
 * code, or empty when the title matches none (the job is kept and its months count toward nothing). `legacyField`
 * is the job's old 37-field value, kept read-only to show "previously: X".
 */
export interface ResumeJob {
  title: string;
  occupation: string;
  legacyField?: string;
  start: string;
  end: string;
  current: boolean;
  description: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Other occupations' years count for this share of their relatedness to the main one (AIService RELATED_CREDIT). */
export const RELATED_CREDIT = 0.3;

/** Same levels as the labeling data and the frontend form. */
export const DEGREE_LEVELS = [
  'Not stated',
  'Below bachelor',
  'Bachelor',
  'Master or higher',
] as const;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const given = (value: unknown) =>
  value !== undefined && value !== null && value !== '';

/** Problems with the career part of resume data, as messages a user can act on. Empty when valid. */
export function resumeCareerProblems(data: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const degree = data.Degree;
  if (given(degree) && !DEGREE_LEVELS.some((level) => level === degree)) {
    problems.push('Choose your highest degree from the list.');
  }
  const hasOccupation = given(data.Occupation);
  const main = findOccupation(data.Occupation);
  if (hasOccupation && !main) {
    problems.push('Choose your occupation from the list.');
  }
  if (given(data.Specialty)) {
    if (!hasOccupation) {
      problems.push('Choose your occupation before its specialty.');
    } else if (
      main &&
      (typeof data.Specialty !== 'string' ||
        !main.specialties.includes(data.Specialty.trim()))
    ) {
      problems.push('Choose a specialty listed under your occupation.');
    }
  }
  if (data.Jobs === undefined || data.Jobs === null) {
    return problems;
  }
  if (!Array.isArray(data.Jobs) || data.Jobs.length > 50) {
    return [...problems, 'Jobs must be a list of at most 50 entries.'];
  }
  data.Jobs.forEach((raw, index) => {
    const label = `Job ${index + 1}`;
    const job = (raw ?? {}) as Record<string, unknown>;
    if (!text(job.title, 120)) problems.push(`${label}: add the job title.`);
    if (given(job.occupation) && !findOccupation(job.occupation)) {
      problems.push(`${label}: choose the occupation from the list.`);
    }
    const start = text(job.start, 7);
    const end = text(job.end, 7);
    if (!MONTH.test(start)) problems.push(`${label}: add the start month.`);
    if (job.current !== true && !MONTH.test(end)) {
      problems.push(`${label}: add the end month, or mark it as current.`);
    } else if (job.current !== true && MONTH.test(start) && end < start) {
      problems.push(`${label}: the end month is before the start month.`);
    }
  });
  return problems;
}

/**
 * Jobs cleaned to the stored shape. Call only after resumeCareerProblems returned no problems. A job saved before
 * occupations (with the old `field`) keeps that value as `legacyField`.
 */
export function cleanResumeJobs(value: unknown): ResumeJob[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const job = (raw ?? {}) as Record<string, unknown>;
    const current = job.current === true;
    const legacyField = text(job.legacyField, 60) || text(job.field, 60);
    return {
      title: text(job.title, 120),
      occupation: findOccupation(job.occupation)?.code ?? '',
      ...(legacyField ? { legacyField } : {}),
      start: text(job.start, 7),
      end: current ? '' : text(job.end, 7),
      current,
      description: text(job.description, 2000),
    };
  });
}

/** Same cap as a job's legacyField. */
const LEGACY_FIELD_MAX = 60;

/**
 * The resume data to store with its legacy values taken from the stored resume, never from the client: the old
 * 37-field values are read-only. `LegacyField` is the stored LegacyField (or, for a resume not yet migrated, its
 * Industry). A job keeps the stored legacyField (or old field) of the stored job with the same title and start
 * month; a new or changed job has none. A resume with no stored legacy values gets none.
 */
export function withStoredLegacy(
  data: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  delete next.LegacyField;
  delete next.Industry;
  const legacyField =
    text(stored.LegacyField, LEGACY_FIELD_MAX) ||
    text(stored.Industry, LEGACY_FIELD_MAX);
  if (legacyField) next.LegacyField = legacyField;
  if (Array.isArray(next.Jobs)) {
    const kept = new Map<string, string[]>();
    for (const job of cleanResumeJobs(stored.Jobs)) {
      if (!job.legacyField) continue;
      const key = `${job.title}\u0000${job.start}`;
      kept.set(key, [...(kept.get(key) ?? []), job.legacyField]);
    }
    next.Jobs = (next.Jobs as ResumeJob[]).map((job) => {
      const rest: ResumeJob = { ...job };
      delete rest.legacyField;
      const found = kept.get(`${job.title}\u0000${job.start}`)?.shift();
      return found ? { ...rest, legacyField: found } : rest;
    });
  }
  return next;
}

/** Python's round(): halves go to the even neighbour (round(2.5) == 2). */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Python's round(value, 1) for value >= 0: the double's exact decimal value rounded to one decimal, ties to even.
 * toFixed rounds the exact value too but sends ties up; an exact tie needs value = odd / 4 (0.25, 0.75, ...).
 */
function roundTenthsHalfEven(value: number): number {
  const quarters = value * 4;
  if (Number.isInteger(quarters) && quarters % 2 !== 0) {
    return roundHalfEven(value * 10) / 10;
  }
  return Number(value.toFixed(1));
}

/** Months since year 0 for "YYYY-MM" (one- or two-digit month, as the AI service reads it), else null. */
function monthIndex(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return Number(match[1]) * 12 + month - 1;
}

/** Months covered by the spans, overlaps counted once. */
function unionMonths(spans: Array<[number, number]>): number {
  let total = 0;
  let span: [number, number] | null = null;
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [start, end] of sorted) {
    if (span && start <= span[1]) {
      span[1] = Math.max(span[1], end);
    } else {
      if (span) total += span[1] - span[0];
      span = [start, end];
    }
  }
  return span ? total + span[1] - span[0] : 0;
}

/**
 * Years in the main occupation, and related years credited from other occupations' jobs. The same as
 * `occupation_years` in AIService app/occupations.py, so the backend and the AI count the same years.
 *
 * Months are unioned per occupation, never added across occupations. Main years are in half years
 * (round(months / 6) / 2, the count the owner's thresholds were set on). Each other occupation gives
 * relatedness x RELATED_CREDIT x its years; the total is rounded to 0.1 and is at most the main years. Jobs without
 * a known occupation or valid dates give nothing. An empty end means the job is current and runs to `today`.
 */
export function occupationYears(
  jobs: ReadonlyArray<{ occupation?: unknown; start?: unknown; end?: unknown }>,
  main: string,
  today = new Date(),
): { years: number; related: number } {
  const now = today.getFullYear() * 12 + today.getMonth();
  const spans = new Map<string, Array<[number, number]>>();
  for (const job of jobs) {
    const code = job.occupation;
    const start = monthIndex(job.start);
    const end =
      job.end === undefined || job.end === null || job.end === ''
        ? now
        : monthIndex(job.end);
    if (
      typeof code !== 'string' ||
      !findOccupation(code) ||
      start === null ||
      end === null ||
      end < start
    ) {
      continue;
    }
    const key = code.trim();
    spans.set(key, [...(spans.get(key) ?? []), [start, end]]);
  }
  const years = roundHalfEven(unionMonths(spans.get(main) ?? []) / 6) / 2;
  spans.delete(main);
  let credit = 0;
  for (const [code, found] of spans) {
    credit +=
      (occupationRelatedness(main, code) *
        RELATED_CREDIT *
        unionMonths(found)) /
      12;
  }
  return { years, related: roundTenthsHalfEven(Math.min(years, credit)) };
}

/** The resume's main occupation (ESCO code), or null until one from the catalogue is chosen. */
export function resumeOccupation(data: Record<string, unknown>): string | null {
  return findOccupation(data.Occupation)?.code ?? null;
}

/**
 * Years in the resume's occupation, counted from the start and end months of its jobs in it (overlaps once; a
 * current job runs to `today`). There is no typed-in number. An occupation with no jobs in it is 0 years, someone
 * starting out. Null until an occupation from the catalogue is chosen.
 */
export function yearsInOccupation(
  data: Record<string, unknown>,
  today = new Date(),
): number | null {
  const main = resumeOccupation(data);
  return main === null
    ? null
    : occupationYears(cleanResumeJobs(data.Jobs), main, today).years;
}

/** Related years credited from the resume's jobs in other occupations; null without an occupation. */
export function relatedYears(
  data: Record<string, unknown>,
  today = new Date(),
): number | null {
  const main = resumeOccupation(data);
  return main === null
    ? null
    : occupationYears(cleanResumeJobs(data.Jobs), main, today).related;
}

/**
 * The highest degree and its ISCED-F field-of-study code from a resume, the part of it a profile shows.
 * Null without a stated degree.
 */
export function resumeEducation(
  data: unknown,
): { degree: string; fieldOfStudy: string | null } | null {
  const record =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const degree = typeof record.Degree === 'string' ? record.Degree.trim() : '';
  if (!degree || degree === 'Not stated') return null;
  const code =
    typeof record.FieldOfStudy === 'string' ? record.FieldOfStudy.trim() : '';
  return { degree, fieldOfStudy: /^\d{4}$/.test(code) ? code : null };
}
