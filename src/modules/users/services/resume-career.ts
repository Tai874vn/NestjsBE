import { isCareerField } from '../../../common/career-fields';

/** A job entry from the resume form: months are "YYYY-MM"; a current job has no end month. */
export interface ResumeJob {
  title: string;
  field: string;
  start: string;
  end: string;
  current: boolean;
  description: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

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

/** Problems with the career part of resume data, as messages a user can act on. Empty when valid. */
export function resumeCareerProblems(data: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const degree = data.Degree;
  if (
    degree !== undefined &&
    degree !== null &&
    degree !== '' &&
    !DEGREE_LEVELS.some((level) => level === degree)
  ) {
    problems.push('Choose your highest degree from the list.');
  }
  const industry = data.Industry;
  if (
    industry !== undefined &&
    industry !== null &&
    industry !== '' &&
    !isCareerField(industry)
  ) {
    problems.push('Choose your field from the list.');
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
    if (!isCareerField(job.field)) problems.push(`${label}: choose the field.`);
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

/** Jobs cleaned to the stored shape. Call only after resumeCareerProblems returned no problems. */
export function cleanResumeJobs(value: unknown): ResumeJob[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const job = (raw ?? {}) as Record<string, unknown>;
    const current = job.current === true;
    return {
      title: text(job.title, 120),
      field: text(job.field, 60),
      start: text(job.start, 7),
      end: current ? '' : text(job.end, 7),
      current,
      description: text(job.description, 2000),
    };
  });
}

function monthIndex(value: string) {
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

/** Months worked in one field, overlapping jobs counted once; current jobs run to `today`. */
export function monthsInField(
  jobs: ResumeJob[],
  field: string,
  today = new Date(),
): number {
  const now = today.getFullYear() * 12 + today.getMonth();
  const spans = jobs
    .filter(
      (job) =>
        job.field === field &&
        MONTH.test(job.start) &&
        (job.current || MONTH.test(job.end)),
    )
    .map(
      (job) =>
        [monthIndex(job.start), job.current ? now : monthIndex(job.end)] as [
          number,
          number,
        ],
    )
    .filter(([start, end]) => end >= start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let span: [number, number] | null = null;
  for (const [start, end] of spans) {
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
 * Years in the user's field, counted from the start and end months of their jobs in it (overlaps once; a current job
 * runs to `today`). It is the only source of years: there is no typed-in number. A chosen field with no jobs in it
 * is 0 years, someone starting out. Null until a field from the list is chosen.
 */
export function yearsInField(
  data: Record<string, unknown>,
  today = new Date(),
): number | null {
  const field = data.Industry;
  if (!isCareerField(field)) return null;
  const months = monthsInField(cleanResumeJobs(data.Jobs), field, today);
  return Math.round((months / 12) * 10) / 10;
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
