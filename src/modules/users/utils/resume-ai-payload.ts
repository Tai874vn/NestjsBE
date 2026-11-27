/**
 * Resume AI payload helpers for the users module.
 * Reads resume JSON values, merges skill lists, and builds the payload sent to the AI service for seniority prediction.
 *
 * Calls: resume-career (cleanResumeJobs, occupationYears, resumeOccupation)
 * Used by:
 *   - src/modules/hiring-pipeline/services/applications-query.service.ts
 *   - src/modules/users/services/resume-ai-queue.service.ts
 *   - src/modules/users/services/user-resume.service.ts
 */

import { Prisma } from '@prisma/client';
import {
  cleanResumeJobs,
  occupationYears,
  resumeOccupation,
} from './resume-career';

/** The parts of a user the resume AI work reads (the seniority payload reads only the headline). */
export interface ResumeOwner {
  headline?: string | null;
  /** Skills from the old single-column `skill` field, already parsed. */
  legacySkills?: string[];
  profileSkills?: Array<{ name: string }>;
}

export function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

export function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }
  return null;
}

/** "React, SQL" or ["React", "SQL"] -> ["React", "SQL"]. */
export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringList(item));
  }
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Merges skill lists, keeping the first spelling of each name (case-insensitive). */
export function mergeSkills(...skillGroups: string[][]): string[] {
  const seen = new Set<string>();
  return skillGroups.flat().flatMap((skill) => {
    const trimmed = skill.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [trimmed];
  });
}

/**
 * The resume payload the AI service's seniority endpoint reads (`features_from_resume` in AIService
 * app/seniority/predictor.py). Years are counted here, as the AI would count them, and always sent: 0 for someone
 * with no jobs in the occupation.
 *
 * In simple words: this builds the "package" of CV facts we send to the AI.
 *  - occupation: the main ESCO occupation the user chose (e.g. "2512.3" = software developer).
 *  - jobs: each job with its own occupation and dates.
 *  - years_in_occupation: years worked in the MAIN occupation (from the job dates).
 *  - related_years: a small extra credit for jobs in RELATED occupations
 *    (e.g. ICT business analyst years count a little for a software developer). See resume-career.ts.
 *  - degree, field_of_study, summary, experience: extra evidence the model reads.
 * Empty values are removed at the end, so the AI only gets what the user filled in.
 */
export function buildResumeSeniorityPayload(
  owner: ResumeOwner,
  data: Record<string, unknown>,
  today = new Date(),
): Record<string, unknown> {
  const occupation = resumeOccupation(data);
  const jobs = cleanResumeJobs(data.Jobs);
  const years = occupation ? occupationYears(jobs, occupation, today) : null;
  const payload: Record<string, unknown> = {
    occupation,
    specialty: firstText(data.Specialty),
    role: firstText(
      data.role,
      data.Role,
      data.title,
      data.Title,
      data.jobTitle,
      data.JobTitle,
      data.Category,
      data.category,
      owner.headline,
    ),
    // Free text where seniority evidence is described (leading, mentoring, tools used).
    summary: firstText(data.summary, data.Summary),
    experience: firstText(data.experience, data.Experience),
    degree: firstText(data.Degree),
    field_of_study: firstText(data.FieldOfStudy),
    // The description is evidence text the AI reads with the title; the old field (legacyField) is not sent.
    jobs: jobs.map((job) => ({
      title: job.title,
      occupation: job.occupation,
      start: job.start,
      end: job.end,
      current: job.current,
      description: job.description,
    })),
    years_in_occupation: years?.years,
    related_years: years?.related,
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => hasValue(value)),
  );
}
