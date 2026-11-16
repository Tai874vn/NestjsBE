import { Prisma } from '@prisma/client';
import { cleanResumeJobs, yearsInField } from './resume-career';

/** The parts of a user the AI seniority payload reads. */
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

/** The resume payload the AI service's seniority endpoint reads. */
export function buildResumeSeniorityPayload(
  owner: ResumeOwner,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const skills = mergeSkills(
    owner.profileSkills?.map((skill) => skill.name) ?? [],
    owner.legacySkills ?? [],
    stringList(data.Skills),
    stringList(data.skills),
  );
  const payload: Record<string, unknown> = {
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
    // Counted from the jobs, like years_in_field; there is no typed-in number any more.
    years_experience: yearsText(data),
    industry: firstText(data.industry, data.Industry),
    specialty: firstText(data.specialty, data.Specialty),
    // Free text where seniority evidence is described (leading, mentoring, tools used).
    summary: firstText(data.summary, data.Summary),
    experience: firstText(data.experience, data.Experience),
    years_in_field: yearsInField(data),
    jobs: cleanResumeJobs(data.Jobs),
    degree: firstText(data.Degree),
    field_of_study: firstText(data.FieldOfStudy),
    education: firstText(data.education, data.Education),
    skills,
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => hasValue(value)),
  );
}

function yearsText(data: Record<string, unknown>): string | undefined {
  const years = yearsInField(data);
  return years === null ? undefined : String(years);
}
