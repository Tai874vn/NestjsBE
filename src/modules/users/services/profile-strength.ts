import { cleanResumeJobs, resumeOccupation } from './resume-career';

/**
 * Profile strength, 0-100: weighted checks that add up to 100. The frontend's `profileStrength`
 * (src/features/users/profile-strength.ts) uses the same table; keep the two in step.
 *
 * Candidates: an occupation 25 (years are counted from the jobs), a dated job 10, skills 15 (half below 5), headline 10, photo 10,
 * About 10, portfolio 10, education 5, location 5.
 * Recruiters: headline 20, photo 20, About 20, location 10, website 10, a hiring post 20.
 * Website, certifications, and a cover image are extras and don't count for candidates.
 */
export const SKILLS_FOR_FULL_CREDIT = 5;

export interface StrengthInput {
  role?: string | null;
  headline?: string | null;
  avatar?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  skills: number;
  /** Portfolio items plus portfolio posts. */
  portfolio: number;
  hiringPosts?: number;
  resumeData?: unknown;
}

const filled = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0;

export function profileStrength(input: StrengthInput): number {
  const parts: Array<[number, number]> = [];
  const add = (weight: number, share: boolean | number) =>
    parts.push([weight, typeof share === 'number' ? share : share ? 1 : 0]);

  if (input.role === 'employer') {
    add(20, filled(input.headline));
    add(20, filled(input.avatar));
    add(20, filled(input.bio));
    add(10, filled(input.location));
    add(10, filled(input.website));
    add(20, (input.hiringPosts ?? 0) > 0);
  } else {
    const data =
      input.resumeData &&
      typeof input.resumeData === 'object' &&
      !Array.isArray(input.resumeData)
        ? (input.resumeData as Record<string, unknown>)
        : {};
    const jobs = cleanResumeJobs(data.Jobs);
    add(25, resumeOccupation(data) !== null);
    add(
      10,
      jobs.some((job) => filled(job.title) && filled(job.start)),
    );
    add(
      15,
      input.skills >= SKILLS_FOR_FULL_CREDIT ? 1 : input.skills > 0 ? 0.5 : 0,
    );
    add(10, filled(input.headline));
    add(10, filled(input.avatar));
    add(10, filled(input.bio));
    add(10, input.portfolio > 0);
    add(
      5,
      filled(data.Degree) &&
        (data.Degree === 'Not stated' || filled(data.FieldOfStudy)),
    );
    add(5, filled(input.location));
  }
  return Math.round(
    parts.reduce((sum, [weight, share]) => sum + weight * share, 0),
  );
}
