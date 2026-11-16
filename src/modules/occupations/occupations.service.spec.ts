import { NotFoundException } from '@nestjs/common';
import { OccupationsService } from './occupations.service';

describe('OccupationsService', () => {
  const service = new OccupationsService();

  it('finds user interface developer for "front end developer"', () => {
    const hits = service.search('front end developer');
    expect(hits.map((h) => h.code)).toContain('2512.4');
    expect(hits.find((h) => h.code === '2512.4')?.matchedLabel).toBeDefined();
  });

  it('ignores hyphens and case', () => {
    const codes = (q: string) => service.search(q).map((h) => h.code);
    expect(codes('FRONT-END developer')).toEqual(codes('front end developer'));
  });

  it('finds web developer for "full stack" with the matched label', () => {
    const hit = service
      .search('full stack', 50)
      .find((h) => h.code === '2513.5');
    expect(hit).toBeDefined();
    expect(hit?.matchedLabel).toMatch(/full.?stack/i);
  });

  it('puts a title hit first and leaves matchedLabel off it', () => {
    const [first] = service.search('web developer');
    expect(first.title.toLowerCase()).toContain('web developer');
    expect(first.matchedLabel).toBeUndefined();
  });

  it('returns one row per occupation, honours limit, empty q gives []', () => {
    expect(service.search('developer', 5)).toHaveLength(5);
    const codes = service.search('developer', 50).map((h) => h.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(service.search('   ')).toEqual([]);
  });

  it('returns the occupation by code and 404 for an unknown one', () => {
    expect(service.occupation('2512.4')).toMatchObject({
      code: '2512.4',
      isco: '2512',
    });
    expect(() => service.occupation('9999.99')).toThrow(NotFoundException);
    expect(service.isOccupation('2512.4')).toBe(true);
    expect(service.isOccupation('nope')).toBe(false);
  });

  it('relatedOverlap returns the stored overlap, else 0', () => {
    const [related] = service.occupation('2512.4').related;
    expect(service.relatedOverlap('2512.4', related.code)).toBe(
      related.overlap,
    );
    expect(service.relatedOverlap('2512.4', '9999.99')).toBe(0);
    expect(service.relatedOverlap('9999.99', '2512.4')).toBe(0);
  });

  it('ranks a prefix hit before a substring hit, even a shorter one', () => {
    const titles = service.search('sales', 50).map((h) => h.title);
    const squashed = titles.map((t) => t.toLowerCase().replace(/[\s-]+/g, ''));
    const prefix = titles.filter((_, i) => squashed[i].startsWith('sales'));
    const inner = titles.filter((_, i) => squashed[i].indexOf('sales') > 0);
    expect(prefix.length).toBeGreaterThan(0);
    expect(inner.length).toBeGreaterThan(0);
    expect(titles.slice(0, prefix.length)).toEqual(prefix);
    // The longest prefix hit is longer than the shortest substring hit, so length is not what ordered them.
    expect(Math.max(...prefix.map((t) => t.length))).toBeGreaterThan(
      Math.min(...inner.map((t) => t.length)),
    );
  });

  it('caps the limit at 50', () => {
    expect(service.search('e', 500)).toHaveLength(50);
  });

  it('relatedness is the Jaccard of skill groups for any pair (as in the AI service)', () => {
    expect(service.relatedness('2513.5', '2512.3')).toBeCloseTo(0.54, 2);
    expect(service.relatedness('2511.8', '2512.3')).toBeCloseTo(0.34, 2);
    // Below the stored related list's 0.25 cut-off, still not 0.
    expect(service.relatedness('2411.1', '2513.5')).toBeCloseTo(0.08, 2);
    expect(service.relatedOverlap('2411.1', '2513.5')).toBe(0);
    expect(service.relatedness('2511.2', '2511.3')).toBeCloseTo(0.84, 2);
    expect(service.relatedness('2513.5', '2513.5')).toBe(1);
    expect(service.relatedness('2513.5', '9999.9')).toBe(0);
  });
});
