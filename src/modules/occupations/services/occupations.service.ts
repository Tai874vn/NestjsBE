/**
 * Occupations module service that indexes the ESCO occupation catalogue in memory for search and lookup.
 * It checks occupation codes, fetches occupation details, ranks text search hits, and computes occupation relatedness.
 *
 * Calls: occupationCatalogue; occupationRelatedness
 * Used by:
 *   - src/modules/occupations/controllers/occupations.controller.ts
 *   - src/modules/occupations/occupations.module.ts
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CatalogueOccupation,
  occupationCatalogue,
  occupationRelatedness,
} from '../utils/occupation-catalogue';

export interface OccupationHit {
  code: string;
  isco: string;
  title: string;
  matchedLabel?: string;
}

/** Spaces and hyphens do not matter: "front end" matches "front-end" (same rule as the AI service). */
function squash(text: string): string {
  return text.toLowerCase().replace(/[\s-]+/g, '');
}

interface IndexedOccupation {
  occupation: CatalogueOccupation;
  title: string;
  altLabels: string[];
  specialties: string[];
}

/**
 * OCCUPATION SEARCH for the "Occupation" box on the CV form, hiring posts and the candidate filter
 * (GET /api/occupations?q=... and GET /api/occupations/:code).
 *
 * The list is the same ESCO catalogue as the AI service (src/common/data/occupations.json, copied from it),
 * read once into memory when the app starts, so searching needs no database and no AI call.
 * The constructor builds an index (a ready-to-search copy): every title, other name and specialty in
 * lower case without spaces or hyphens. Typing "front end" then finds "Front-End Developer", and the
 * frontend picker shows the occupation it belongs to.
 */
@Injectable()
export class OccupationsService {
  private readonly byCode = occupationCatalogue();
  private readonly index: IndexedOccupation[];

  constructor() {
    this.index = [...this.byCode.values()].map((occupation) => ({
      occupation,
      title: squash(occupation.title),
      altLabels: occupation.altLabels.map(squash),
      specialties: occupation.specialties.map(squash),
    }));
  }

  isOccupation(code: string): boolean {
    return this.byCode.has(code);
  }

  /** The occupation, or a 404 for an unknown code. */
  occupation(code: string) {
    const found = this.byCode.get(code);
    if (!found) throw new NotFoundException(`Unknown occupation ${code}`);
    return {
      code: found.code,
      isco: found.isco,
      title: found.title,
      specialties: found.specialties,
      related: found.related,
    };
  }

  /** Skill-group overlap (Jaccard) stored for `a` against `b`; 0 when not related. */
  relatedOverlap(a: string, b: string): number {
    return this.byCode.get(a)?.related.find((r) => r.code === b)?.overlap ?? 0;
  }

  /** Jaccard of the two occupations' skill groups, for any pair (as the AI service computes it). */
  relatedness(a: string, b: string): number {
    return occupationRelatedness(a, b);
  }

  /**
   * Title hits rank first, then altLabel, then specialty; within a tier a prefix
   * match beats a substring match. One row per occupation.
   */
  search(q: string, limit = 20): OccupationHit[] {
    const needle = squash(q ?? '');
    if (!needle) return [];
    const cap = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);

    const ranked: Array<{ rank: number; hit: OccupationHit }> = [];
    for (const entry of this.index) {
      const { occupation } = entry;
      const base = {
        code: occupation.code,
        isco: occupation.isco,
        title: occupation.title,
      };
      const tiers: Array<[number, string[], string[]]> = [
        [0, [entry.title], [occupation.title]],
        [2, entry.altLabels, occupation.altLabels],
        [4, entry.specialties, occupation.specialties],
      ];
      let best: { rank: number; hit: OccupationHit } | undefined;
      for (const [tier, squashed, labels] of tiers) {
        for (let i = 0; i < squashed.length; i++) {
          const at = squashed[i].indexOf(needle);
          if (at < 0) continue;
          const rank = tier + (at === 0 ? 0 : 1);
          if (!best || rank < best.rank) {
            best = {
              rank,
              hit: tier === 0 ? base : { ...base, matchedLabel: labels[i] },
            };
          }
        }
        if (best) break;
      }
      if (best) ranked.push(best);
    }
    ranked.sort(
      (x, y) =>
        x.rank - y.rank ||
        x.hit.title.length - y.hit.title.length ||
        x.hit.code.localeCompare(y.hit.code),
    );
    return ranked.slice(0, cap).map((r) => r.hit);
  }
}
