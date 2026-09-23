import { describe, expect, it } from 'vitest';
import scales from '../../src/data/scales.json';
import { pointsForGrade, rowForPercent, isAverageable, type Scale } from '../../src/lib/grades';

const data = scales as unknown as Scale[];

describe('scales dataset', () => {
  it('has no duplicate slugs', () => {
    const slugs = data.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every scale has at least one row and a source', () => {
    for (const s of data) {
      expect(s.rows.length, `${s.slug} has rows`).toBeGreaterThan(0);
      if (s.generic) {
        expect(s.source.url, `${s.slug} is generic, so its source url should be null (not a self-citation)`).toBeNull();
      } else {
        expect(s.source.url, `${s.slug} has a source url`).toMatch(/^https:\/\//);
      }
      expect(s.source.title.length, `${s.slug} has a source title`).toBeGreaterThan(0);
      expect(s.source.verified, `${s.slug} has a verified date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('non-generic scales cite a real institution domain, not our own site', () => {
    for (const s of data.filter((s) => !s.generic)) {
      expect(s.source.url).not.toMatch(/rouraroble\.github\.io/);
    }
  });

  it('inverted or descriptive scales are excluded from the interactive averager', () => {
    for (const s of data.filter((s) => s.inverted || s.descriptive)) {
      expect(isAverageable(s), `${s.slug} should not be averageable`).toBe(false);
    }
  });

  it('every grade name is unique within its own scale', () => {
    for (const s of data) {
      const names = s.rows.map((r) => r.grade);
      expect(new Set(names).size, `${s.slug} has unique grade names`).toBe(names.length);
    }
  });

  it('percentage bands (where present) do not have min > max', () => {
    for (const s of data) {
      for (const r of s.rows) {
        if (r.min != null && r.max != null) expect(r.min, `${s.slug} ${r.grade}`).toBeLessThanOrEqual(r.max);
      }
    }
  });

  it('pointsForGrade resolves every row on the standard 4.0 scale', () => {
    const scale = data.find((s) => s.slug === 'us-4-0')!;
    expect(pointsForGrade(scale, 'A')).toBe(4.0);
    expect(pointsForGrade(scale, 'a-')).toBe(3.7);
    expect(pointsForGrade(scale, 'F')).toBe(0);
    expect(pointsForGrade(scale, 'Q')).toBeNull();
  });

  it('rowForPercent resolves a sensible band on the University of Toronto scale', () => {
    const scale = data.find((s) => s.slug === 'university-of-toronto-4-0')!;
    expect(rowForPercent(scale, 92)?.grade).toBe('A+');
    expect(rowForPercent(scale, 85)?.grade).toBe('A');
    expect(rowForPercent(scale, 45)?.grade).toBe('F');
  });

  it('the MIT scale matches the documented 5-point values', () => {
    const scale = data.find((s) => s.slug === 'mit-5-0')!;
    expect(pointsForGrade(scale, 'A')).toBe(5);
    expect(pointsForGrade(scale, 'F')).toBe(0);
    expect(scale.max).toBe(5);
  });

  it('weighted scales define both honors and AP bonuses', () => {
    for (const s of data.filter((s) => s.weighted)) {
      expect(s.weighted!.honors).toBeGreaterThan(0);
      expect(s.weighted!.ap).toBeGreaterThanOrEqual(s.weighted!.honors);
    }
  });
});
