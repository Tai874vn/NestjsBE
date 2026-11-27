/**
 * Profile data normalizer for the users module.
 * Deduplicates skills and certifications, parses legacy JSON string lists, and trims or lowercases profile text.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/users/services/candidate-directory.service.ts
 *   - src/modules/users/services/resume-ai-queue.service.ts
 *   - src/modules/users/services/user-profile.service.ts
 *   - src/modules/users/services/user-resume.service.ts
 *   - src/modules/users/users.module.ts
 *   - src/tools/benchmark-candidates.ts
 */

import { Injectable } from '@nestjs/common';

@Injectable()
export class UserProfileNormalizerService {
  withLegacyProfileSkills<T extends { name: string }>(
    skills: T[],
    legacySkill?: string | null,
  ) {
    const normalizedSkills = this.normalizeProfileRows(skills);
    if (normalizedSkills.length > 0) {
      return normalizedSkills;
    }

    return this.parseStringArrayValue(legacySkill).map((name, index) => ({
      id: 0 - index,
      name,
      level: null,
      sortOrder: index,
      createdAt: null,
      updatedAt: null,
    }));
  }

  withLegacyProfileCertifications<T extends { name: string }>(
    certifications: T[],
    legacyCertification?: string | null,
  ) {
    const normalizedCertifications = this.normalizeProfileRows(certifications);
    if (normalizedCertifications.length > 0) {
      return normalizedCertifications;
    }

    return this.parseStringArrayValue(legacyCertification).map(
      (name, index) => ({
        id: 0 - index,
        userId: null,
        name,
        issuer: null,
        issuedAt: null,
        expiresAt: null,
        credentialUrl: null,
        credentialId: null,
        category: null,
        skills: [],
        sortOrder: index,
        createdAt: null,
        updatedAt: null,
      }),
    );
  }

  normalizeProfileRows<T extends { name: string }>(rows: T[]): T[] {
    const seenNames = new Set<string>();

    return rows.flatMap((row) =>
      this.parseStringArrayValue(row.name).flatMap((name) => {
        const key = name.toLowerCase();
        if (seenNames.has(key)) {
          return [];
        }

        seenNames.add(key);
        return [{ ...row, name }];
      }),
    );
  }

  parseStringArrayValue(value?: string | null): string[] {
    if (!value) {
      return [];
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) =>
          typeof item === 'string' ? this.parseStringArrayValue(item) : [],
        );
      }
    } catch {
      return [trimmed];
    }

    return [trimmed];
  }

  trimOptional(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed || null;
  }

  normalizeText(value?: unknown): string {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim().toLowerCase();
    }

    return '';
  }
}
