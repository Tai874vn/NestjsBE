import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One ESCO occupation from src/common/data/occupations.json (synced from the AI service). */
export interface CatalogueOccupation {
  code: string;
  isco: string;
  title: string;
  altLabels: string[];
  specialties: string[];
  /** The closest occupations only (overlap >= 0.25, at most 15), for search and filters. */
  related: Array<{ code: string; overlap: number }>;
  /** ESCO skill groups; relatedness of any pair is their Jaccard. */
  groups: number[];
}

let cached: Map<string, CatalogueOccupation> | null = null;

/** The catalogue by code, read once. */
export function occupationCatalogue(): Map<string, CatalogueOccupation> {
  if (!cached) {
    const payload: { occupations: CatalogueOccupation[] } = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', 'common', 'data', 'occupations.json'),
        'utf8',
      ),
    );
    cached = new Map(payload.occupations.map((o) => [o.code, o]));
  }
  return cached;
}

/** The occupation for an ESCO code (surrounding spaces ignored), or undefined. */
export function findOccupation(code: unknown): CatalogueOccupation | undefined {
  return typeof code === 'string'
    ? occupationCatalogue().get(code.trim())
    : undefined;
}

/**
 * Jaccard of the two occupations' skill groups; 0 when either is unknown or both have no groups.
 * Same as `relatedness` in AIService app/occupations.py.
 */
export function occupationRelatedness(a: unknown, b: unknown): number {
  const first = findOccupation(a);
  const second = findOccupation(b);
  if (!first || !second) return 0;
  const groups = new Set(first.groups);
  const union = new Set([...first.groups, ...second.groups]);
  const shared = [...new Set(second.groups)].filter((group) =>
    groups.has(group),
  ).length;
  return union.size ? shared / union.size : 0;
}
