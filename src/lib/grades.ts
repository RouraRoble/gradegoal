/**
 * GradeGoal core formulas. Pure, dependency-free, unit-tested (tests/unit/grades.test.ts).
 * All percentages are plain numbers (88 = 88 %). Weights are percentages of the course grade.
 * Nothing here rounds: callers format for display.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a finite number into [min, max]; non-finite input returns `fallback`. */
export function clamp(n: unknown, min: number, max: number, fallback = min): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Parse a user-typed number ("87,5", " 90 %") → number or null. */
export function parseNum(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(',', '.').replace(/%$/, '').trim();
  if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Round half away from zero to `d` decimals (avoids 1.005 → 1.00 float artefacts). */
export function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
}

export const fmt = (n: number, d = 1): string => {
  if (!Number.isFinite(n)) return '—';
  const r = round(n, d);
  return Number.isInteger(r) ? String(r) : r.toFixed(d).replace(/\.?0+$/, '');
};

// ---------------------------------------------------------------------------
// Final grade calculator
// ---------------------------------------------------------------------------

/**
 * Score needed on the final.
 *   grade = current × (1 − w) + final × w   ⇒   final = (target − current × (1 − w)) / w
 * @param current current grade in the course (%), before the final
 * @param weightPct weight of the final as % of the course grade (0 < w ≤ 100)
 * @param target the course grade you want (%)
 */
export function neededOnFinal(current: number, weightPct: number, target: number): number {
  const w = weightPct / 100;
  if (w <= 0) return Number.NaN;
  return (target - current * (1 - w)) / w;
}

/** Course grade you end with if you score `finalScore` on the final. */
export function gradeAfterFinal(current: number, weightPct: number, finalScore: number): number {
  const w = weightPct / 100;
  return current * (1 - w) + finalScore * w;
}

export type Feasibility = 'secured' | 'easy' | 'ok' | 'hard' | 'impossible';

/** Classify a needed score. `ceiling` = max score obtainable on the final (100 unless extra credit). */
export function feasibility(needed: number, ceiling = 100): Feasibility {
  if (!Number.isFinite(needed)) return 'impossible';
  if (needed <= 0) return 'secured';
  if (needed > ceiling) return 'impossible';
  if (needed < 60) return 'easy';
  if (needed <= 85) return 'ok';
  return 'hard';
}

export const FEASIBILITY_LABEL: Record<Feasibility, string> = {
  secured: 'Already secured',
  easy: 'Very doable',
  ok: 'Doable',
  hard: 'Tough',
  impossible: 'Not possible',
};

/**
 * Variant A — the final counts as a test and replaces your lowest test score.
 * The tests (equal weight) make up `testsWeightPct` of the course; the rest is `otherGrade`.
 * With n tests and the final added, the lowest of the n+1 scores is dropped.
 * Needed final F (assuming F ≥ lowest): (target − (1−w)·other)/w = (Σtests − min + F)/n
 * If the result is below the lowest test, the final itself would be dropped and the grade is already decided.
 */
export function neededReplacingLowest(opts: {
  tests: number[];
  target: number;
  testsWeightPct?: number;
  otherGrade?: number;
}): { needed: number; currentAverage: number; alreadyDecided: boolean; resultingIfDropped: number } {
  const tests = opts.tests.filter((t) => Number.isFinite(t));
  const n = tests.length;
  const w = (opts.testsWeightPct ?? 100) / 100;
  const other = opts.otherGrade ?? 0;
  if (n === 0 || w <= 0) return { needed: Number.NaN, currentAverage: Number.NaN, alreadyDecided: false, resultingIfDropped: Number.NaN };
  const sum = tests.reduce((a, b) => a + b, 0);
  const min = Math.min(...tests);
  const currentAverage = sum / n;
  const requiredTestAvg = (opts.target - (1 - w) * other) / w;
  const needed = requiredTestAvg * n - (sum - min);
  // If needed < lowest test, the final would be the dropped score: the grade stays as-is.
  const resultingIfDropped = (1 - w) * other + w * currentAverage;
  return { needed, currentAverage, alreadyDecided: needed <= min, resultingIfDropped };
}

/**
 * Variant B — the final is split in two parts (e.g. two exams worth 15 % each).
 * If part 1 is already known (`part1Score`), returns what you need on part 2.
 * If not, returns the score you need on BOTH parts (same score assumed).
 */
export function neededTwoPartFinal(opts: {
  current: number;
  weight1Pct: number;
  weight2Pct: number;
  target: number;
  part1Score?: number | null;
}): { needed: number; mode: 'part2' | 'both' } {
  const w1 = opts.weight1Pct / 100;
  const w2 = opts.weight2Pct / 100;
  const rest = 1 - w1 - w2;
  if (opts.part1Score == null) {
    const wt = w1 + w2;
    return { needed: wt <= 0 ? Number.NaN : (opts.target - opts.current * rest) / wt, mode: 'both' };
  }
  return { needed: w2 <= 0 ? Number.NaN : (opts.target - opts.current * rest - opts.part1Score * w1) / w2, mode: 'part2' };
}

/**
 * Variant C — points-based course.
 *   (earned + F) / (possible + finalPoints) = target/100  ⇒  F = target/100 × (possible + finalPoints) − earned
 */
export function neededPoints(opts: { earned: number; possible: number; finalPoints: number; target: number }): {
  neededPoints: number;
  neededPct: number;
  currentPct: number;
} {
  const total = opts.possible + opts.finalPoints;
  const np = (opts.target / 100) * total - opts.earned;
  return {
    neededPoints: np,
    neededPct: opts.finalPoints > 0 ? (np / opts.finalPoints) * 100 : Number.NaN,
    currentPct: opts.possible > 0 ? (opts.earned / opts.possible) * 100 : Number.NaN,
  };
}

/** Common US letter thresholds (a common convention, not one published standard). Individual syllabi differ. */
export const LETTER_THRESHOLDS: { letter: string; min: number }[] = [
  { letter: 'A+', min: 97 },
  { letter: 'A', min: 93 },
  { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 },
  { letter: 'B', min: 83 },
  { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 },
  { letter: 'C', min: 73 },
  { letter: 'C-', min: 70 },
  { letter: 'D+', min: 67 },
  { letter: 'D', min: 63 },
  { letter: 'D-', min: 60 },
];

export function letterFor(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  for (const t of LETTER_THRESHOLDS) if (pct >= t.min) return t.letter;
  return 'F';
}

/** Needed score on the final for every letter target. */
export function targetTable(current: number, weightPct: number, ceiling = 100) {
  return LETTER_THRESHOLDS.map((t) => {
    const needed = neededOnFinal(current, weightPct, t.min);
    return { letter: t.letter, target: t.min, needed, feasibility: feasibility(needed, ceiling) };
  });
}

/** Full weight matrix used by the programmatic /final-grade/{w}-percent-final/ pages. */
export function finalGradeMatrix(weightPct: number, currents: number[], targets: number[]) {
  return currents.map((c) => ({
    current: c,
    cells: targets.map((t) => {
      const needed = neededOnFinal(c, weightPct, t);
      return { target: t, needed, feasibility: feasibility(needed) };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Weighted grade book
// ---------------------------------------------------------------------------

export interface GradeItem {
  id: string;
  name: string;
  score: number | null; // earned (points) — null = not graded yet
  possible: number; // max points (100 for percentages)
  hypothetical?: boolean; // "what-if" row, excluded from the current grade
}
export interface Category {
  id: string;
  name: string;
  weight: number; // % of course grade
  drop: number; // number of lowest scores to drop
  items: GradeItem[];
}
export type AverageMethod = 'points' | 'equal';

export interface CategoryResult {
  id: string;
  name: string;
  weight: number;
  average: number | null; // % or null when nothing graded
  counted: number; // items counted after drops
  dropped: string[]; // ids of dropped items
}
export interface CourseResult {
  current: number | null; // weighted grade over graded categories only (weights renormalised)
  projected: number | null; // same, including hypothetical items
  weightTotal: number;
  gradedWeight: number;
  categories: CategoryResult[];
}

function categoryAverage(cat: Category, method: AverageMethod, includeHypothetical: boolean): CategoryResult {
  const graded = cat.items.filter(
    (it) => it.score != null && Number.isFinite(it.score) && it.possible > 0 && (includeHypothetical || !it.hypothetical),
  );
  const withPct = graded.map((it) => ({ it, pct: ((it.score as number) / it.possible) * 100 }));
  const drop = Math.max(0, Math.min(Math.floor(cat.drop || 0), Math.max(0, withPct.length - 1)));
  const sorted = [...withPct].sort((a, b) => a.pct - b.pct);
  const dropped = sorted.slice(0, drop).map((x) => x.it.id);
  const kept = withPct.filter((x) => !dropped.includes(x.it.id));
  let average: number | null = null;
  if (kept.length) {
    if (method === 'equal') average = kept.reduce((a, x) => a + x.pct, 0) / kept.length;
    else {
      const e = kept.reduce((a, x) => a + (x.it.score as number), 0);
      const p = kept.reduce((a, x) => a + x.it.possible, 0);
      average = (e / p) * 100;
    }
  }
  return { id: cat.id, name: cat.name, weight: cat.weight, average, counted: kept.length, dropped };
}

/**
 * Weighted course grade. Categories with no graded items are ignored and the remaining
 * weights are renormalised (this is how most LMSs report a "current grade").
 */
export function courseGrade(categories: Category[], method: AverageMethod = 'points'): CourseResult {
  const weightTotal = categories.reduce((a, c) => a + (Number.isFinite(c.weight) ? c.weight : 0), 0);
  const calc = (hyp: boolean) => {
    const res = categories.map((c) => categoryAverage(c, method, hyp));
    const graded = res.filter((r) => r.average != null && r.weight > 0);
    const gw = graded.reduce((a, r) => a + r.weight, 0);
    const value = gw > 0 ? graded.reduce((a, r) => a + (r.average as number) * r.weight, 0) / gw : null;
    return { res, gw, value };
  };
  const cur = calc(false);
  const proj = calc(true);
  return { current: cur.value, projected: proj.value, weightTotal, gradedWeight: cur.gw, categories: cur.res };
}

/**
 * Score needed on the remaining (ungraded) weight to reach `target`, given the current
 * grade and how much of the course weight is already graded.
 */
export function neededOnRemaining(current: number, gradedWeightPct: number, totalWeightPct: number, target: number): number {
  const remaining = totalWeightPct - gradedWeightPct;
  if (remaining <= 0) return Number.NaN;
  return (target * totalWeightPct - current * gradedWeightPct) / remaining;
}

// ---------------------------------------------------------------------------
// GPA
// ---------------------------------------------------------------------------

export interface ScaleRow {
  grade: string;
  points: number | null; // null = not counted (e.g. Pass/Withdrawn)
  min?: number; // percentage band lower bound (inclusive)
  max?: number; // percentage band upper bound (inclusive)
  label?: string; // descriptor (e.g. "High Distinction")
}
export interface Scale {
  slug: string;
  name: string;
  short?: string;
  kind: 'letter' | 'percent' | 'classification' | 'numeric' | 'ects' | 'cgpa';
  region: string;
  max: number; // top grade points (4.0, 4.3, 5.0, 7, 10 …)
  passing?: number;
  weighted?: { honors: number; ap: number };
  rows: ScaleRow[];
  /** `url` is null for generic conventions with no single citable institution (avoids self-citing our own About page). */
  source: { url: string | null; title: string; verified: string };
  notes: string[];
  generic?: boolean;
  /** Lower points = better grade (e.g. Germany's 1.0–5.0). Never usable in an ascending-average calculator. */
  inverted?: boolean;
  /** Points are invented "mention" midpoints, not a real per-course grade-point column. */
  descriptive?: boolean;
  /** How percentage-band cells should be labelled: '%' (default) or a raw 'score' (e.g. Spain's /10). */
  bandKind?: 'percent' | 'score';
}

/** Scales whose points form a real, ascending per-course GPA column — safe for the interactive averager. */
export function isAverageable(scale: Pick<Scale, 'rows' | 'kind' | 'slug' | 'inverted' | 'descriptive'>): boolean {
  return (
    scale.rows.every((r) => r.points != null) &&
    (scale.kind === 'letter' || scale.kind === 'percent' || scale.kind === 'numeric') &&
    scale.slug !== 'ubc-percent' &&
    !scale.inverted &&
    !scale.descriptive
  );
}

export type CourseKind = 'regular' | 'honors' | 'ap';
export interface GpaCourse {
  id: string;
  name: string;
  grade: string;
  credits: number;
  kind?: CourseKind;
}

export function pointsForGrade(scale: Pick<Scale, 'rows'>, grade: string): number | null {
  const g = grade.trim().toUpperCase();
  const row = scale.rows.find((r) => r.grade.toUpperCase() === g);
  return row ? row.points : null;
}

/** Add the honors/AP bonus. F (0 points) never earns a bonus. */
export function weightedPoints(points: number | null, kind: CourseKind | undefined, weighted?: Scale['weighted']): number | null {
  if (points == null) return null;
  if (!weighted || !kind || kind === 'regular' || points <= 0) return points;
  return points + (kind === 'ap' ? weighted.ap : weighted.honors);
}

export interface GpaResult {
  gpa: number | null;
  qualityPoints: number;
  credits: number; // GPA credits (courses with a graded, counted grade)
  courses: { id: string; points: number | null; qualityPoints: number; counted: boolean }[];
}

export function semesterGpa(courses: GpaCourse[], scale: Scale, useWeighted = false): GpaResult {
  let qp = 0;
  let cr = 0;
  const rows = courses.map((c) => {
    const base = pointsForGrade(scale, c.grade);
    const pts = useWeighted ? weightedPoints(base, c.kind, scale.weighted) : base;
    const credits = Number.isFinite(c.credits) && c.credits > 0 ? c.credits : 0;
    const counted = pts != null && credits > 0;
    const q = counted ? (pts as number) * credits : 0;
    if (counted) {
      qp += q;
      cr += credits;
    }
    return { id: c.id, points: pts, qualityPoints: q, counted };
  });
  return { gpa: cr > 0 ? qp / cr : null, qualityPoints: qp, credits: cr, courses: rows };
}

/** Cumulative GPA = (priorGPA × priorCredits + newQualityPoints) / (priorCredits + newCredits). */
export function cumulativeGpa(priorGpa: number, priorCredits: number, sem: Pick<GpaResult, 'qualityPoints' | 'credits'>): number | null {
  const total = priorCredits + sem.credits;
  if (total <= 0) return null;
  return (priorGpa * priorCredits + sem.qualityPoints) / total;
}

/** Map a percentage to a row of a percent-band scale (first matching band). */
export function rowForPercent(scale: Pick<Scale, 'rows'>, pct: number): ScaleRow | null {
  if (!Number.isFinite(pct)) return null;
  return scale.rows.find((r) => r.min != null && r.max != null && pct >= r.min && pct <= r.max) ?? null;
}

// ---------------------------------------------------------------------------
// GPA planner
// ---------------------------------------------------------------------------

/**
 * Average GPA needed over `newCredits` to move a `currentGpa` (earned over `currentCredits`) to `target`.
 *   needed = (target × (C + N) − current × C) / N
 */
export function requiredAverage(currentGpa: number, currentCredits: number, target: number, newCredits: number): number {
  if (newCredits <= 0) return Number.NaN;
  return (target * (currentCredits + newCredits) - currentGpa * currentCredits) / newCredits;
}

/** Highest GPA reachable after `newCredits` at the scale maximum. */
export function maxReachable(currentGpa: number, currentCredits: number, newCredits: number, scaleMax: number): number {
  const total = currentCredits + newCredits;
  if (total <= 0) return Number.NaN;
  return (currentGpa * currentCredits + scaleMax * newCredits) / total;
}

/** Fewest credits at `avg` needed to reach `target` (null if unreachable, 0 if already there). */
export function creditsNeeded(currentGpa: number, currentCredits: number, target: number, avg: number): number | null {
  if (currentGpa >= target) return 0;
  if (avg <= target) return null;
  // (G·C + a·N)/(C+N) = T ⇒ N = C·(T − G)/(a − T)
  return (currentCredits * (target - currentGpa)) / (avg - target);
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** UK honours classification from an overall percentage (common thresholds). */
export function ukClassification(pct: number): { label: string; short: string } {
  if (!Number.isFinite(pct)) return { label: '—', short: '—' };
  if (pct >= 70) return { label: 'First-class honours', short: '1st' };
  if (pct >= 60) return { label: 'Upper second-class honours', short: '2:1' };
  if (pct >= 50) return { label: 'Lower second-class honours', short: '2:2' };
  if (pct >= 40) return { label: 'Third-class honours', short: '3rd' };
  return { label: 'Fail', short: 'Fail' };
}

/** CBSE convention: percentage ≈ CGPA × 9.5 (Class X, 10-point scale). */
export const CGPA_FACTOR = 9.5;
export const cgpaToPercent = (cgpa: number) => cgpa * CGPA_FACTOR;
export const percentToCgpa = (pct: number) => pct / CGPA_FACTOR;

/** Linear GPA → percentage (some Indian/other institutions use gpa/max × 100). */
export const gpaToPercentLinear = (gpa: number, max = 4) => (gpa / max) * 100;
