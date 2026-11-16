import {
  occupationYears,
  cleanResumeJobs,
  resumeOccupation,
} from '../../users/services/resume-career';
import { findOccupation } from '../../occupations/occupation-catalogue';
import { Injectable } from '@nestjs/common';

export type UserForRecommendation = {
  id: number;
  name?: string | null;
  avatar?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  skill?: string | null;
  profileSkills?: Array<{ name: string; level?: string | null }>;
  resume?: {
    data: unknown;
    predictedSeniority?: string | null;
    predictedSeniorityConfidence?: number | null;
  } | null;
};

export type HiringPostForRecommendation = {
  id: number;
  recruiterId: number;
  title: string;
  description: string;
  requirements?: string | null;
  location?: string | null;
  employmentType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  careerField?: string | null;
  yearsRequired?: number | null;
  skills?: string[];
  predictedSeniority?: string | null;
  predictedSeniorityConfidence?: number | null;
  predictedSeniorityModel?: string | null;
  predictedSeniorityMetadata?: unknown;
  predictedSeniorityAt?: Date | null;
  status?: string;
  updatedAt: Date;
};

@Injectable()
export class RecommendationPayloadMapperService {
  buildResumePayload(user: UserForRecommendation): Record<string, unknown> {
    const data = this.asRecord(user.resume?.data);
    const sanitizedData = this.sanitizeResumeData(data);
    const skills = this.mergeSkills(
      user.profileSkills?.map((skill) => skill.name) ?? [],
      this.parseStringArrayValue(user.skill),
      this.parseDelimitedString(sanitizedData.Skills),
    );
    const role = this.firstString(
      sanitizedData.Role,
      sanitizedData.role,
      sanitizedData.Title,
      sanitizedData.title,
      sanitizedData.JobTitle,
      sanitizedData.jobTitle,
      sanitizedData.Category,
      sanitizedData.category,
      user.headline,
    );
    // The ESCO occupation; its title is the text the ranking reads as `industry`.
    const occupation = resumeOccupation(sanitizedData);
    const industry = occupation
      ? (findOccupation(occupation)?.title ?? null)
      : null;
    // Years in the occupation, counted from the resume's jobs as the AI counts them.
    const years = occupation
      ? occupationYears(cleanResumeJobs(sanitizedData.Jobs), occupation)
      : null;
    const yearsExperience = years === null ? undefined : String(years.years);
    const text = [
      user.headline,
      user.bio,
      user.location,
      role,
      industry,
      yearsExperience ? `${yearsExperience} years experience` : null,
      sanitizedData.Category,
      sanitizedData.Summary,
      sanitizedData.Skills,
      sanitizedData.Experience,
      sanitizedData.Education,
      sanitizedData.Text,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      id: user.id,
      seniority: user.resume?.predictedSeniority,
      seniority_resume: user.resume?.predictedSeniority,
      seniority_confidence: user.resume?.predictedSeniorityConfidence,
      role: role ?? 'Candidate',
      title: role ?? user.headline ?? `Candidate #${user.id}`,
      location: user.location ?? sanitizedData.Location,
      skills,
      summary: user.bio ?? sanitizedData.Summary,
      occupation,
      industry,
      years_experience: yearsExperience,
      years_in_occupation: years?.years,
      related_years: years?.related,
      experience: sanitizedData.Experience,
      education: sanitizedData.Education,
      text: this.redactContactInfo(text),
      data: sanitizedData,
    };
  }

  buildHiringPostPayload(
    post: HiringPostForRecommendation,
    knownSkills: string[] = [],
  ): Record<string, unknown> {
    const postText = this.hiringPostToText(post);
    const requiredSkills = this.hiringPostRequiredSkills(post, knownSkills);
    return {
      id: post.id,
      job_title: post.title,
      title: post.title,
      seniority: post.predictedSeniority,
      seniority_job: post.predictedSeniority,
      seniority_confidence: post.predictedSeniorityConfidence,
      description: post.description,
      requirements: post.requirements,
      must_have_skills: requiredSkills,
      required_skills: requiredSkills,
      nice_to_have_skills: post.description,
      text: postText,
      location: post.location,
      employment_type: post.employmentType,
      salary_min: post.salaryMin,
      salary_max: post.salaryMax,
      // Set by the recruiter on the form; the AI uses them before guessing from the text.
      career_field: post.careerField,
      years_required: post.yearsRequired,
      skills: post.skills ?? [],
    };
  }

  hiringPostToText(post: HiringPostForRecommendation): string {
    return [
      post.title,
      post.description,
      post.requirements,
      post.location,
      post.employmentType,
      post.salaryMin !== null && post.salaryMin !== undefined
        ? `salary minimum ${post.salaryMin}`
        : null,
      post.salaryMax !== null && post.salaryMax !== undefined
        ? `salary maximum ${post.salaryMax}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  hiringPostCategoryText(post: HiringPostForRecommendation): string {
    return [post.employmentType, post.location].filter(Boolean).join(' ');
  }

  private skillsMentionedInText(skills: string[], text: string): string[] {
    const normalizedText = text.toLowerCase();
    return skills.filter((skill) =>
      normalizedText.includes(skill.toLowerCase()),
    );
  }

  private hiringPostRequiredSkills(
    post: HiringPostForRecommendation,
    knownSkills: string[],
  ): string[] {
    if (post.skills?.length) return post.skills;
    const explicitSkills = this.parseDelimitedString(post.requirements);
    if (explicitSkills.length) {
      return explicitSkills;
    }
    return this.skillsMentionedInText(knownSkills, this.hiringPostToText(post));
  }

  private mergeSkills(...skillGroups: string[][]): string[] {
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

  private parseStringArrayValue(value?: string | null): string[] {
    if (!value?.trim()) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) =>
          typeof item === 'string' ? this.parseDelimitedString(item) : [],
        );
      }
    } catch {
      return this.parseDelimitedString(value);
    }

    return this.parseDelimitedString(value);
  }

  private parseDelimitedString(value: unknown): string[] {
    if (typeof value !== 'string') {
      return [];
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private firstString(...values: unknown[]): string | null {
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

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private sanitizeResumeData(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const omittedKeys = new Set([
      'name',
      'email',
      'phone',
      'resumeid',
      'source',
    ]);
    return Object.fromEntries(
      Object.entries(data).flatMap(([key, value]) => {
        if (omittedKeys.has(key.toLowerCase())) {
          return [];
        }

        return [[key, this.sanitizeResumeValue(value)]];
      }),
    );
  }

  private sanitizeResumeValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.redactContactInfo(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeResumeValue(item));
    }

    if (value && typeof value === 'object') {
      return this.sanitizeResumeData(value as Record<string, unknown>);
    }

    return value;
  }

  private redactContactInfo(value: string): string {
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted-phone]');
  }
}
