import { describe, expect, it } from 'vitest';
import {
  encodeFinal,
  decodeFinal,
  FINAL_DEFAULTS,
  encodeGradeBook,
  decodeGradeBook,
  encodeGpa,
  decodeGpa,
  encodePlanner,
  decodePlanner,
  CAPS,
} from '../../src/lib/urlstate';

describe('final grade URL state', () => {
  it('encodes the spec example ?c=88&w=30&t=90', () => {
    expect(encodeFinal({ ...FINAL_DEFAULTS, mode: 'basic', current: 88, weight: 30, target: 90 })).toBe('?c=88&w=30&t=90');
  });
  it('round-trips every mode', () => {
    const states = [
      { ...FINAL_DEFAULTS, mode: 'basic' as const, current: 77.5, weight: 40, target: 85 },
      { ...FINAL_DEFAULTS, mode: 'lowest' as const, tests: [80, 90, 70.5], target: 85, testsWeight: 60, other: 92 },
      { ...FINAL_DEFAULTS, mode: 'two' as const, current: 88, weight1: 15, weight2: 20, part1: 81, target: 90 },
      { ...FINAL_DEFAULTS, mode: 'points' as const, earned: 412, possible: 500, finalPoints: 200, target: 90 },
    ];
    for (const s of states) {
      const d = decodeFinal(encodeFinal(s));
      expect(d.mode).toBe(s.mode);
      expect(d.target).toBe(s.target);
      if (s.mode === 'basic') {
        expect(d.current).toBe(s.current);
        expect(d.weight).toBe(s.weight);
      }
      if (s.mode === 'lowest') {
        expect(d.tests).toEqual(s.tests);
        expect(d.testsWeight).toBe(60);
        expect(d.other).toBe(92);
      }
      if (s.mode === 'two') {
        expect(d.part1).toBe(81);
        expect(d.weight2).toBe(20);
      }
      if (s.mode === 'points') expect(d.finalPoints).toBe(200);
    }
  });
  it('clamps hostile input and falls back to defaults', () => {
    const d = decodeFinal('?c=99999&w=0&t=-50&m=evil&x=' + Array(100).fill('1e9').join(','));
    expect(d.current).toBe(200);
    // A non-positive weight (0 or negative) falls back to the default rather than clamping up to
    // 0.01, which used to blow up the needed-score formula into distorted numbers like "20088%".
    expect(d.weight).toBe(FINAL_DEFAULTS.weight);
    expect(d.target).toBe(0);
    expect(d.mode).toBe('basic');
    expect(d.tests).toEqual(FINAL_DEFAULTS.tests); // '1e9' is rejected by parseNum → empty → defaults
    const d2 = decodeFinal('?m=lowest&x=' + Array(100).fill('99').join(','));
    expect(d2.tests.length).toBe(CAPS.tests);
    expect(decodeFinal('?c=abc').current).toBe(FINAL_DEFAULTS.current);
  });

  it('a negative or zero weight falls back to the default instead of distorting the result (regression for audit P2-1/P2-5)', () => {
    // Previously a malformed w=-5 was clamped up to 0.01, which made neededOnFinal() explode to
    // absurd values like "20088%" for otherwise-default current/target.
    for (const bad of ['-5', '0', '-0.01']) {
      const d = decodeFinal(`?w=${bad}`);
      expect(d.weight, `w=${bad}`).toBe(FINAL_DEFAULTS.weight);
    }
    for (const bad of ['-5', '0']) {
      expect(decodeFinal(`?m=two&w1=${bad}`).weight1, `w1=${bad}`).toBe(FINAL_DEFAULTS.weight1);
      expect(decodeFinal(`?m=two&w2=${bad}`).weight2, `w2=${bad}`).toBe(FINAL_DEFAULTS.weight2);
      expect(decodeFinal(`?m=lowest&tw=${bad}`).testsWeight, `tw=${bad}`).toBe(FINAL_DEFAULTS.testsWeight);
    }
    // A genuinely positive weight still decodes and clamps normally.
    expect(decodeFinal('?w=45').weight).toBe(45);
    expect(decodeFinal('?w=500').weight).toBe(100);
  });
});

describe('grade book URL state', () => {
  const share = {
    name: 'Biology 101',
    method: 'points' as const,
    categories: [
      { id: 'a', name: 'Homework', weight: 20, drop: 1, items: [{ id: '1', name: 'HW 1', score: 9, possible: 10 }, { id: '2', name: 'HW 2', score: null, possible: 10 }] },
      { id: 'b', name: 'Exams: Mid, Final', weight: 80, drop: 0, items: [{ id: '3', name: 'Midterm', score: 85.5, possible: 100, hypothetical: true }] },
    ],
  };
  it('teacher link carries structure but no scores', () => {
    const url = encodeGradeBook(share, false);
    expect(url).toContain('cats=');
    expect(url).not.toContain('i0=');
    const d = decodeGradeBook(url)!;
    expect(d.name).toBe('Biology 101');
    expect(d.categories.map((c) => [c.name, c.weight, c.drop])).toEqual([
      ['Homework', 20, 1],
      ['Exams  Mid  Final', 80, 0],
    ]);
    expect(d.categories[0].items).toEqual([]);
  });
  it('full link round-trips scores, blanks and what-if flags', () => {
    const d = decodeGradeBook(encodeGradeBook(share, true))!;
    expect(d.categories[0].items.map((i) => [i.name, i.score, i.possible])).toEqual([
      ['HW 1', 9, 10],
      ['HW 2', null, 10],
    ]);
    expect(d.categories[1].items[0].hypothetical).toBe(true);
    expect(d.categories[1].items[0].score).toBe(85.5);
  });
  it('returns null without cats and caps list sizes', () => {
    expect(decodeGradeBook('?n=x')).toBeNull();
    const many = '?cats=' + Array(50).fill('C:2').join(',') + '&i0=' + Array(200).fill('x:1/1').join(',');
    const d = decodeGradeBook(many)!;
    expect(d.categories.length).toBe(CAPS.categories);
    expect(d.categories[0].items.length).toBe(CAPS.items);
  });
  it('strips angle brackets from names', () => {
    const d = decodeGradeBook('?cats=%3Cscript%3Ealert(1)%3C/script%3E:50')!;
    expect(d.categories[0].name).not.toContain('<');
  });
});

describe('GPA URL state', () => {
  const valid = (s: string) => s === 'us-4-0' || s === 'us-4-3';
  it('round-trips courses, kinds and prior GPA', () => {
    const url = encodeGpa({
      scale: 'us-4-3',
      weighted: true,
      priorGpa: 3.2,
      priorCredits: 45,
      courses: [
        { id: '1', name: 'x', grade: 'A', credits: 3, kind: 'regular' },
        { id: '2', name: 'y', grade: 'B+', credits: 4, kind: 'honors' },
        { id: '3', name: 'z', grade: 'A-', credits: 3, kind: 'ap' },
      ],
    });
    expect(url).toBe('?s=us-4-3&wt=1&pg=3.2&pc=45&c=A%3A3%2CB%2B%3A4%3Ah%2CA-%3A3%3Aa');
    const d = decodeGpa(url, valid, 'us-4-0')!;
    expect(d.scale).toBe('us-4-3');
    expect(d.weighted).toBe(true);
    expect(d.priorGpa).toBe(3.2);
    expect(d.courses.map((c) => [c.grade, c.credits, c.kind])).toEqual([
      ['A', 3, 'regular'],
      ['B+', 4, 'honors'],
      ['A-', 3, 'ap'],
    ]);
  });
  it('falls back to a valid scale and returns null when empty', () => {
    expect(decodeGpa('?s=../../etc&c=A:3', valid, 'us-4-0')!.scale).toBe('us-4-0');
    expect(decodeGpa('', valid, 'us-4-0')).toBeNull();
  });
});

describe('planner URL state', () => {
  it('round-trips and clamps to the scale max', () => {
    const s = { gpa: 3.1, credits: 45, target: 3.5, newCredits: 30, max: 4 };
    expect(encodePlanner(s)).toBe('?g=3.1&c=45&t=3.5&n=30');
    expect(decodePlanner(encodePlanner(s))).toEqual(s);
    const d = decodePlanner('?g=9&t=9&n=0&mx=5');
    expect(d.max).toBe(5);
    expect(d.gpa).toBe(5);
    expect(d.newCredits).toBe(0.5);
  });
});
