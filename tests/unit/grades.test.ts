import { describe, expect, it } from 'vitest';
import {
  neededOnFinal,
  gradeAfterFinal,
  feasibility,
  neededReplacingLowest,
  neededTwoPartFinal,
  neededPoints,
  letterFor,
  targetTable,
  finalGradeMatrix,
  courseGrade,
  neededOnRemaining,
  semesterGpa,
  cumulativeGpa,
  weightedPoints,
  pointsForGrade,
  rowForPercent,
  requiredAverage,
  maxReachable,
  creditsNeeded,
  ukClassification,
  cgpaToPercent,
  percentToCgpa,
  parseNum,
  clamp,
  round,
  fmt,
  type Scale,
  type Category,
} from '../../src/lib/grades';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('helpers', () => {
  it('parses numbers leniently', () => {
    expect(parseNum('87,5')).toBe(87.5);
    expect(parseNum(' 90 % ')).toBe(90);
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
    expect(parseNum('1e3')).toBeNull();
    expect(parseNum(NaN)).toBeNull();
  });
  it('clamps and rounds', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp('x', 0, 100, 7)).toBe(7);
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(94.66666, 2)).toBe(94.67);
    expect(fmt(94.66666)).toBe('94.7');
    expect(fmt(90)).toBe('90');
    expect(fmt(NaN)).toBe('—');
  });
});

describe('final grade — basic', () => {
  it('spec case: current 88, weight 30, target 90 → 94.67', () => {
    expect(round(neededOnFinal(88, 30, 90), 2)).toBe(94.67);
  });
  it('hand-computed cases', () => {
    // (90 - 85*0.75)/0.25 = (90-63.75)/0.25 = 105
    expect(neededOnFinal(85, 25, 90)).toBeCloseTo(105, 10);
    // (80 - 92*0.5)/0.5 = 68
    expect(neededOnFinal(92, 50, 80)).toBeCloseTo(68, 10);
    // weight 100% → target itself
    expect(neededOnFinal(50, 100, 70)).toBeCloseTo(70, 10);
    // (70 - 95*0.8)/0.2 = (70-76)/0.2 = -30 (already secured)
    expect(neededOnFinal(95, 20, 70)).toBeCloseTo(-30, 10);
  });
  it('is the inverse of gradeAfterFinal', () => {
    const needed = neededOnFinal(88, 30, 90);
    expect(gradeAfterFinal(88, 30, needed)).toBeCloseTo(90, 10);
    expect(gradeAfterFinal(88, 30, 78)).toBeCloseTo(85, 10); // 61.6 + 23.4
  });
  it('rejects zero weight', () => {
    expect(Number.isNaN(neededOnFinal(88, 0, 90))).toBe(true);
  });
  it('classifies feasibility with labels not just colour', () => {
    expect(feasibility(-5)).toBe('secured');
    expect(feasibility(0)).toBe('secured');
    expect(feasibility(40)).toBe('easy');
    expect(feasibility(75)).toBe('ok');
    expect(feasibility(95)).toBe('hard');
    expect(feasibility(100.01)).toBe('impossible');
    expect(feasibility(105, 110)).toBe('hard');
    expect(feasibility(NaN)).toBe('impossible');
  });
  it('letter thresholds and target table', () => {
    expect(letterFor(97)).toBe('A+');
    expect(letterFor(92.9)).toBe('A-');
    expect(letterFor(59.9)).toBe('F');
    const t = targetTable(88, 30);
    expect(t[0].letter).toBe('A+');
    expect(t.find((r) => r.letter === 'A-')?.needed).toBeCloseTo(94.6667, 3);
    expect(t.find((r) => r.letter === 'A+')?.feasibility).toBe('impossible'); // (97-61.6)/0.3 = 118
  });
  it('builds the programmatic matrix', () => {
    const m = finalGradeMatrix(30, [50, 100], [60, 95]);
    expect(m).toHaveLength(2);
    expect(m[0].cells[0].needed).toBeCloseTo((60 - 35) / 0.3, 10); // 83.33
    expect(m[1].cells[1].needed).toBeCloseTo((95 - 70) / 0.3, 10); // 83.33
    expect(m[0].cells[1].feasibility).toBe('impossible'); // (95-35)/0.3 = 200
  });
});

describe('final grade — variants', () => {
  it('final replaces lowest test (tests = 100% of grade)', () => {
    // tests 80, 90, 70 (avg 80). Final replaces the 70: (80+90+F)/3 = 85 → F = 85
    const r = neededReplacingLowest({ tests: [80, 90, 70], target: 85 });
    expect(r.needed).toBeCloseTo(85, 10);
    expect(r.currentAverage).toBeCloseTo(80, 10);
    expect(r.alreadyDecided).toBe(false);
  });
  it('final replaces lowest with an "other" portion', () => {
    // tests 60% of grade, other 40% at 90. target 85 → required test avg = (85 - 0.4*90)/0.6 = 81.667
    // tests 82, 91, 76 → drop 76: (82+91+F)/3 = 81.667 → F = 245 - 173 = 72
    const r = neededReplacingLowest({ tests: [82, 91, 76], target: 85, testsWeightPct: 60, otherGrade: 90 });
    expect(r.needed).toBeCloseTo(72, 6);
  });
  it('flags when the final would be dropped instead', () => {
    // tests 95, 96, 97 target 80 → F = 240 - 193 = 47 < min 95 → grade already decided
    const r = neededReplacingLowest({ tests: [95, 96, 97], target: 80 });
    expect(r.alreadyDecided).toBe(true);
    expect(r.resultingIfDropped).toBeCloseTo(96, 10);
  });
  it('two-part final: part 1 known', () => {
    // current 88 over 70%, parts 15/15, part1 = 80, target 90:
    // F = (90 - 88*0.7 - 80*0.15)/0.15 = (90 - 61.6 - 12)/0.15 = 16.4/0.15 = 109.33
    const r = neededTwoPartFinal({ current: 88, weight1Pct: 15, weight2Pct: 15, target: 90, part1Score: 80 });
    expect(r.mode).toBe('part2');
    expect(r.needed).toBeCloseTo(109.3333, 3);
  });
  it('two-part final: both parts unknown collapses to the basic formula', () => {
    const r = neededTwoPartFinal({ current: 88, weight1Pct: 15, weight2Pct: 15, target: 90, part1Score: null });
    expect(r.mode).toBe('both');
    expect(r.needed).toBeCloseTo(neededOnFinal(88, 30, 90), 10);
  });
  it('points-based', () => {
    // 412/500 earned, final 200 pts, target 90%: 0.9*700 = 630 - 412 = 218 pts → 109%
    const r = neededPoints({ earned: 412, possible: 500, finalPoints: 200, target: 90 });
    expect(r.neededPoints).toBeCloseTo(218, 10);
    expect(r.neededPct).toBeCloseTo(109, 10);
    expect(r.currentPct).toBeCloseTo(82.4, 10);
    const ok = neededPoints({ earned: 450, possible: 500, finalPoints: 200, target: 85 });
    expect(ok.neededPoints).toBeCloseTo(145, 10); // 0.85*700 = 595 - 450
    expect(ok.neededPct).toBeCloseTo(72.5, 10);
  });
});

describe('weighted grade book', () => {
  const cats: Category[] = [
    {
      id: 'hw',
      name: 'Homework',
      weight: 20,
      drop: 1,
      items: [
        { id: '1', name: 'HW1', score: 10, possible: 10 },
        { id: '2', name: 'HW2', score: 6, possible: 10 },
        { id: '3', name: 'HW3', score: 9, possible: 10 },
      ],
    },
    {
      id: 'ex',
      name: 'Exams',
      weight: 50,
      drop: 0,
      items: [
        { id: '4', name: 'Midterm', score: 85, possible: 100 },
        { id: '5', name: 'Final', score: null, possible: 100 },
      ],
    },
    { id: 'pr', name: 'Project', weight: 30, drop: 0, items: [] },
  ];
  it('drops the lowest and renormalises weights over graded categories', () => {
    const r = courseGrade(cats);
    // homework: drop HW2 → (10+9)/20 = 95%. exams: 85%. project: nothing graded → ignored.
    // current = (95*20 + 85*50)/70 = (1900+4250)/70 = 87.857
    expect(r.categories[0].average).toBeCloseTo(95, 10);
    expect(r.categories[0].dropped).toEqual(['2']);
    expect(r.categories[2].average).toBeNull();
    expect(r.current).toBeCloseTo(87.857142857, 6);
    expect(r.gradedWeight).toBe(70);
    expect(r.weightTotal).toBe(100);
  });
  it('supports equal-weight averaging within a category', () => {
    const c: Category[] = [
      { id: 'a', name: 'A', weight: 100, drop: 0, items: [{ id: '1', name: 'x', score: 5, possible: 10 }, { id: '2', name: 'y', score: 90, possible: 100 }] },
    ];
    expect(courseGrade(c, 'points').current).toBeCloseTo((95 / 110) * 100, 10); // 86.36
    expect(courseGrade(c, 'equal').current).toBeCloseTo(70, 10); // (50+90)/2
  });
  it('what-if rows only affect the projected grade', () => {
    const c: Category[] = [
      { id: 'a', name: 'A', weight: 100, drop: 0, items: [{ id: '1', name: 'x', score: 80, possible: 100 }, { id: '2', name: 'y', score: 100, possible: 100, hypothetical: true }] },
    ];
    const r = courseGrade(c);
    expect(r.current).toBeCloseTo(80, 10);
    expect(r.projected).toBeCloseTo(90, 10);
  });
  it('never drops every item', () => {
    const c: Category[] = [{ id: 'a', name: 'A', weight: 100, drop: 5, items: [{ id: '1', name: 'x', score: 70, possible: 100 }] }];
    expect(courseGrade(c).current).toBeCloseTo(70, 10);
  });
  it('needed on remaining weight', () => {
    // current 87.857 over 70 of 100, target 90 → (9000 - 6150)/30 = 95
    expect(neededOnRemaining(87.857142857, 70, 100, 90)).toBeCloseTo(95, 5);
    expect(Number.isNaN(neededOnRemaining(90, 100, 100, 95))).toBe(true);
  });
});

const scale: Scale = {
  slug: 'test-4',
  name: 'Test 4.0',
  kind: 'letter',
  region: 'US',
  max: 4,
  weighted: { honors: 0.5, ap: 1 },
  rows: [
    { grade: 'A', points: 4 },
    { grade: 'A-', points: 3.7 },
    { grade: 'B+', points: 3.3 },
    { grade: 'B', points: 3 },
    { grade: 'C', points: 2 },
    { grade: 'F', points: 0 },
    { grade: 'P', points: null },
  ],
  source: { url: 'https://example.test', title: 'x', verified: '2026-09-23' },
  notes: [],
};

describe('GPA', () => {
  it('semester GPA with 3 courses', () => {
    // A(3) B+(4) A-(3): (12 + 13.2 + 11.1)/10 = 3.63
    const r = semesterGpa(
      [
        { id: '1', name: 'a', grade: 'A', credits: 3 },
        { id: '2', name: 'b', grade: 'B+', credits: 4 },
        { id: '3', name: 'c', grade: 'A-', credits: 3 },
      ],
      scale,
    );
    expect(r.gpa).toBeCloseTo(3.63, 10);
    expect(r.credits).toBe(10);
  });
  it('ignores pass/uncounted grades and zero credits', () => {
    const r = semesterGpa(
      [
        { id: '1', name: 'a', grade: 'A', credits: 3 },
        { id: '2', name: 'b', grade: 'P', credits: 3 },
        { id: '3', name: 'c', grade: 'B', credits: 0 },
        { id: '4', name: 'd', grade: 'ZZ', credits: 3 },
      ],
      scale,
    );
    expect(r.gpa).toBe(4);
    expect(r.credits).toBe(3);
    expect(r.courses[3].counted).toBe(false);
  });
  it('weighted honors/AP bonus, never on F', () => {
    expect(weightedPoints(4, 'ap', scale.weighted)).toBe(5);
    expect(weightedPoints(3, 'honors', scale.weighted)).toBe(3.5);
    expect(weightedPoints(0, 'ap', scale.weighted)).toBe(0);
    expect(weightedPoints(4, 'regular', scale.weighted)).toBe(4);
    const r = semesterGpa(
      [
        { id: '1', name: 'a', grade: 'A', credits: 1, kind: 'ap' },
        { id: '2', name: 'b', grade: 'B', credits: 1, kind: 'honors' },
      ],
      scale,
      true,
    );
    expect(r.gpa).toBeCloseTo(4.25, 10); // (5 + 3.5)/2
  });
  it('grade lookup is case-insensitive', () => {
    expect(pointsForGrade(scale, 'a-')).toBe(3.7);
    expect(pointsForGrade(scale, 'Q')).toBeNull();
  });
  it('cumulative GPA', () => {
    // prior 3.2 × 45 = 144; semester 36.3 / 10 → (144+36.3)/55 = 3.278
    expect(cumulativeGpa(3.2, 45, { qualityPoints: 36.3, credits: 10 })).toBeCloseTo(3.27818, 4);
    expect(cumulativeGpa(0, 0, { qualityPoints: 0, credits: 0 })).toBeNull();
  });
  it('maps a percentage to a band', () => {
    const s = { rows: [{ grade: 'A', points: 4, min: 90, max: 100 }, { grade: 'B', points: 3, min: 80, max: 89 }] };
    expect(rowForPercent(s, 90)?.grade).toBe('A');
    expect(rowForPercent(s, 89)?.grade).toBe('B');
    expect(rowForPercent(s, 50)).toBeNull();
  });
});

describe('planner', () => {
  it('spec case: raise 3.1 (45 cr) to 3.5 in 30 cr', () => {
    // (3.5*75 - 3.1*45)/30 = (262.5 - 139.5)/30 = 4.1
    expect(requiredAverage(3.1, 45, 3.5, 30)).toBeCloseTo(4.1, 10);
    expect(requiredAverage(3.1, 45, 3.3, 30)).toBeCloseTo(3.6, 10); // (247.5-139.5)/30
  });
  it('max reachable and credits needed', () => {
    expect(maxReachable(3.1, 45, 30, 4)).toBeCloseTo((139.5 + 120) / 75, 10); // 3.46
    // N = C(T-G)/(a-T) = 45*(0.4)/(0.5) = 36
    expect(creditsNeeded(3.1, 45, 3.5, 4)).toBeCloseTo(36, 10);
    expect(creditsNeeded(3.6, 45, 3.5, 4)).toBe(0);
    expect(creditsNeeded(3.1, 45, 3.5, 3.5)).toBeNull();
  });
});

describe('conversions', () => {
  it('UK classification', () => {
    expect(ukClassification(70).short).toBe('1st');
    expect(ukClassification(69.9).short).toBe('2:1');
    expect(ukClassification(50).short).toBe('2:2');
    expect(ukClassification(45).short).toBe('3rd');
    expect(ukClassification(39).short).toBe('Fail');
  });
  it('CGPA × 9.5', () => {
    expect(cgpaToPercent(8.2)).toBeCloseTo(77.9, 10);
    expect(percentToCgpa(95)).toBeCloseTo(10, 10);
    expect(near(percentToCgpa(cgpaToPercent(7.3)), 7.3)).toBe(true);
  });
});
