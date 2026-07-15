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
  resume?: { data: unknown } | null;
};

export type JobForRecommendation = {
  id: number;
  title: string;
  price?: number;
  image?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  rating?: number;
  reviews?: number;
  creatorId?: number;
  createdAt?: Date;
  updatedAt?: Date;
  subcategory?: {
    name: string;
    category?: { name: string } | null;
  } | null;
  user?: {
    id: number;
    name: string;
    avatar?: string | null;
  } | null;
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
    const text = [
      user.headline,
      user.bio,
      user.location,
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
      role: user.headline ?? sanitizedData.Category ?? 'Candidate',
      title: user.headline ?? sanitizedData.Category ?? `Candidate #${user.id}`,
      location: user.location ?? sanitizedData.Location,
      skills,
      summary: user.bio ?? sanitizedData.Summary,
      experience: sanitizedData.Experience,
      education: sanitizedData.Education,
      text: this.redactContactInfo(text),
      data: sanitizedData,
    };
  }

  buildJobPayload(job: JobForRecommendation, knownSkills: string[] = []): Record<string, unknown> {
    const jobText = this.jobToText(job);
    return {
      id: job.id,
      job_title: job.title,
      title: job.title,
      description: job.description,
      short_description: job.shortDescription,
      industry: job.subcategory?.category?.name,
      required_skills: this.skillsMentionedInText(knownSkills, jobText),
      text: jobText,
      category: job.subcategory?.category?.name,
      subcategory: job.subcategory?.name,
    };
  }

  jobToText(job: JobForRecommendation): string {
    return [
      job.title,
      job.shortDescription,
      job.description,
      job.subcategory?.name,
      job.subcategory?.category?.name,
    ]
      .filter(Boolean)
      .join('\n');
  }

  jobCategoryText(job: JobForRecommendation): string {
    return [job.subcategory?.name, job.subcategory?.category?.name].filter(Boolean).join(' ');
  }

  private skillsMentionedInText(skills: string[], text: string): string[] {
    const normalizedText = text.toLowerCase();
    return skills.filter((skill) => normalizedText.includes(skill.toLowerCase()));
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
        return parsed.flatMap((item) => (typeof item === 'string' ? this.parseDelimitedString(item) : []));
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

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private sanitizeResumeData(data: Record<string, unknown>): Record<string, unknown> {
    const omittedKeys = new Set(['name', 'email', 'phone', 'resumeid', 'source']);
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
