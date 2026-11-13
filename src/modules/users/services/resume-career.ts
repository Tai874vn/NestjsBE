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

/** Years in the user's field: from dated jobs when there are any, else from the YearsExperience box. */
export function yearsInField(
  data: Record<string, unknown>,
  today = new Date(),
): number | null {
  const field = data.Industry;
  const jobs = cleanResumeJobs(data.Jobs);
  if (isCareerField(field) && jobs.some((job) => job.field === field)) {
    return Math.round((monthsInField(jobs, field, today) / 12) * 10) / 10;
  }
  const raw = data.YearsExperience;
  const typed =
    typeof raw === 'number'
      ? String(raw)
      : typeof raw === 'string'
        ? raw.trim()
        : '';
  const declared = Number(typed.replace(',', '.'));
  return typed && Number.isFinite(declared) && declared >= 0 ? declared : null;
}
