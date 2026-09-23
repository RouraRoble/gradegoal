/**
 * URL state encode/decode for share links. Every decoder clamps and caps its input so a
 * malicious link can never hang or break the page. Query-string based (not hash) so the
 * server-rendered page can pre-fill values and so OG scrapers see the same URL.
 */
import type { Category, GpaCourse, CourseKind } from './grades';
import { clamp, parseNum } from './grades';

export const CAPS = { name: 40, categories: 20, items: 60, courses: 40, tests: 30 } as const;

const num = (p: URLSearchParams, key: string, min: number, max: number): number | null => {
  const raw = p.get(key);
  if (raw == null) return null;
  const v = parseNum(raw);
  return v == null ? null : clamp(v, min, max);
};

/** Like `num`, but a value at or below zero (e.g. a malformed negative weight) is treated as absent
 * (falls back to the caller's default) instead of being clamped up to a tiny, distorting minimum. */
const numPositive = (p: URLSearchParams, key: string, min: number, max: number): number | null => {
  const raw = p.get(key);
  if (raw == null) return null;
  const v = parseNum(raw);
  return v == null || v <= 0 ? null : clamp(v, min, max);
};

const safeName = (s: string | null | undefined, fallback: string) => {
  const t = (s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, CAPS.name);
  return t || fallback;
};

const q = (obj: Record<string, string | number | null | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------
// Final grade
// ---------------------------------------------------------------------------

export type FinalMode = 'basic' | 'lowest' | 'two' | 'points';
export interface FinalState {
  mode: FinalMode;
  current: number; // c
  weight: number; // w
  target: number; // t
  tests: number[]; // x (lowest-replaced): comma list
  testsWeight: number; // tw
  other: number; // o
  weight1: number; // w1
  weight2: number; // w2
  part1: number | null; // s1
  earned: number; // e
  possible: number; // p
  finalPoints: number; // fp
}

export const FINAL_DEFAULTS: FinalState = {
  mode: 'basic',
  current: 88,
  weight: 30,
  target: 90,
  tests: [82, 91, 76],
  testsWeight: 100,
  other: 90,
  weight1: 15,
  weight2: 15,
  part1: null,
  earned: 412,
  possible: 500,
  finalPoints: 200,
};

export function encodeFinal(s: FinalState): string {
  const base = { m: s.mode === 'basic' ? null : s.mode, t: s.target };
  switch (s.mode) {
    case 'lowest':
      return q({ ...base, x: s.tests.map((t) => +t.toFixed(2)).join(','), tw: s.testsWeight === 100 ? null : s.testsWeight, o: s.testsWeight === 100 ? null : s.other });
    case 'two':
      return q({ ...base, c: s.current, w1: s.weight1, w2: s.weight2, s1: s.part1 });
    case 'points':
      return q({ ...base, e: s.earned, p: s.possible, fp: s.finalPoints });
    default:
      return q({ c: s.current, w: s.weight, t: s.target });
  }
}

export function decodeFinal(search: string, defaults: FinalState = FINAL_DEFAULTS): FinalState {
  const p = new URLSearchParams(search);
  const modeRaw = p.get('m');
  const mode: FinalMode = modeRaw === 'lowest' || modeRaw === 'two' || modeRaw === 'points' ? modeRaw : 'basic';
  const tests = (p.get('x') ?? '')
    .split(',')
    .map((t) => parseNum(t))
    .filter((v): v is number => v != null)
    .map((v) => clamp(v, 0, 200))
    .slice(0, CAPS.tests);
  return {
    mode,
    current: num(p, 'c', 0, 200) ?? defaults.current,
    weight: numPositive(p, 'w', 0.01, 100) ?? defaults.weight,
    target: num(p, 't', 0, 200) ?? defaults.target,
    tests: tests.length ? tests : defaults.tests,
    testsWeight: numPositive(p, 'tw', 0.01, 100) ?? defaults.testsWeight,
    other: num(p, 'o', 0, 200) ?? defaults.other,
    weight1: numPositive(p, 'w1', 0.01, 100) ?? defaults.weight1,
    weight2: numPositive(p, 'w2', 0.01, 100) ?? defaults.weight2,
    part1: num(p, 's1', 0, 200),
    earned: num(p, 'e', 0, 1e6) ?? defaults.earned,
    possible: num(p, 'p', 0, 1e6) ?? defaults.possible,
    finalPoints: num(p, 'fp', 0, 1e6) ?? defaults.finalPoints,
  };
}

// ---------------------------------------------------------------------------
// Grade book (weighted grade calculator)
// ---------------------------------------------------------------------------

export interface GradeBookShare {
  name: string;
  term?: string;
  /** The saved course id this state belongs to, if any (used to detect "reload of my own saved course" vs. an externally shared link). */
  id?: string;
  categories: Category[];
  method: 'points' | 'equal';
}

let idCounter = 0;
export const uid = (prefix = 'i'): string => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/**
 * Teacher link: categories, weights and drop counts only (no scores).
 *   ?n=Biology%20101&cats=Homework:20:1,Quizzes:20,Exams:60
 * Full share: adds each category's items as `i<idx>=name:score/possible,…` (scores included).
 * `s.id` (a real saved-course id, not the 'draft' placeholder) is written only for the address-bar
 * copy of the state, so a reload can be recognised as "my own saved course" rather than a shared link
 * — see GradeBook.tsx. It is never included when generating a link to send to someone else.
 */
export function encodeGradeBook(s: GradeBookShare, includeScores: boolean): string {
  const cats = s.categories
    .slice(0, CAPS.categories)
    .map((c) => [safeName(c.name, 'Category').replace(/[:,]/g, ' '), +c.weight.toFixed(2), c.drop ? Math.floor(c.drop) : null].filter((x) => x != null).join(':'))
    .join(',');
  const obj: Record<string, string | number | null> = {
    n: s.name || null,
    tm: s.term || null,
    id: s.id && s.id !== 'draft' ? s.id : null,
    cats,
    am: s.method === 'equal' ? 'equal' : null,
  };
  if (includeScores) {
    s.categories.slice(0, CAPS.categories).forEach((c, idx) => {
      const items = c.items
        .slice(0, CAPS.items)
        .map((it) => `${safeName(it.name, 'Item').replace(/[:,/]/g, ' ')}:${it.score == null ? '' : +it.score.toFixed(2)}/${+it.possible.toFixed(2)}${it.hypothetical ? '?' : ''}`)
        .join(',');
      if (items) obj[`i${idx}`] = items;
    });
  }
  return q(obj);
}

export function decodeGradeBook(search: string): GradeBookShare | null {
  const p = new URLSearchParams(search);
  const cats = p.get('cats');
  if (!cats) return null;
  const categories: Category[] = cats
    .split(',')
    .slice(0, CAPS.categories)
    .map((part, idx) => {
      const [name, w, d] = part.split(':');
      const weight = clamp(parseNum(w ?? '') ?? 0, 0, 100);
      const drop = clamp(parseNum(d ?? '') ?? 0, 0, 20);
      const items = (p.get(`i${idx}`) ?? '')
        .split(',')
        .filter(Boolean)
        .slice(0, CAPS.items)
        .map((raw) => {
          const hypothetical = raw.endsWith('?');
          const body = hypothetical ? raw.slice(0, -1) : raw;
          const ci = body.lastIndexOf(':');
          const iname = ci >= 0 ? body.slice(0, ci) : body;
          const [sc, po] = (ci >= 0 ? body.slice(ci + 1) : '').split('/');
          const score = sc === '' || sc == null ? null : parseNum(sc);
          const possible = clamp(parseNum(po ?? '') ?? 100, 0.01, 1e6, 100);
          return { id: uid(), name: safeName(iname, 'Item'), score: score == null ? null : clamp(score, 0, 1e6), possible, hypothetical };
        });
      return { id: uid('c'), name: safeName(name, `Category ${idx + 1}`), weight, drop: Math.floor(drop), items };
    });
  return {
    name: safeName(p.get('n'), ''),
    term: safeName(p.get('tm'), ''),
    id: (p.get('id') ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 40) || undefined,
    categories,
    method: p.get('am') === 'equal' ? 'equal' : 'points',
  };
}

// ---------------------------------------------------------------------------
// GPA calculator
// ---------------------------------------------------------------------------

export interface GpaShare {
  scale: string;
  weighted: boolean;
  priorGpa: number | null;
  priorCredits: number | null;
  courses: GpaCourse[];
  /** The saved semester's id and name, if any (used to detect "reload of my own saved semester" vs.
   * an externally shared link) — same pattern as `GradeBookShare.id`. */
  id?: string;
  name?: string;
}

/** ?s=us-4-0&wt=1&pg=3.2&pc=45&c=A:3,B+:4:h,A-:3:a */
export function encodeGpa(s: GpaShare): string {
  const c = s.courses
    .slice(0, CAPS.courses)
    .map((x) => [x.grade.replace(/[:,]/g, ''), +x.credits.toFixed(2), x.kind === 'honors' ? 'h' : x.kind === 'ap' ? 'a' : null].filter((v) => v != null).join(':'))
    .join(',');
  return q({ s: s.scale, wt: s.weighted ? 1 : null, pg: s.priorGpa, pc: s.priorCredits, c, id: s.id && s.id !== 'draft' ? s.id : null, n: s.name || null });
}

export function decodeGpa(search: string, validScale: (slug: string) => boolean, fallbackScale: string): GpaShare | null {
  const p = new URLSearchParams(search);
  if (!p.has('c') && !p.has('s')) return null;
  const scaleRaw = (p.get('s') ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
  const scale = validScale(scaleRaw) ? scaleRaw : fallbackScale;
  const courses: GpaCourse[] = (p.get('c') ?? '')
    .split(',')
    .filter(Boolean)
    .slice(0, CAPS.courses)
    .map((part, i) => {
      const [g, cr, k] = part.split(':');
      const kind: CourseKind = k === 'h' ? 'honors' : k === 'a' ? 'ap' : 'regular';
      return { id: uid('g'), name: `Course ${i + 1}`, grade: (g ?? '').slice(0, 6), credits: clamp(parseNum(cr ?? '') ?? 0, 0, 50), kind };
    });
  return {
    scale,
    weighted: p.get('wt') === '1',
    priorGpa: num(p, 'pg', 0, 20),
    priorCredits: num(p, 'pc', 0, 1000),
    courses,
    id: (p.get('id') ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 40) || undefined,
    name: safeName(p.get('n'), ''),
  };
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export interface PlannerState {
  gpa: number;
  credits: number;
  target: number;
  newCredits: number;
  max: number;
}
export const PLANNER_DEFAULTS: PlannerState = { gpa: 3.1, credits: 45, target: 3.5, newCredits: 30, max: 4 };

export function encodePlanner(s: PlannerState): string {
  return q({ g: s.gpa, c: s.credits, t: s.target, n: s.newCredits, mx: s.max === 4 ? null : s.max });
}
export function decodePlanner(search: string, d: PlannerState = PLANNER_DEFAULTS): PlannerState {
  const p = new URLSearchParams(search);
  const max = num(p, 'mx', 1, 20) ?? d.max;
  return {
    max,
    gpa: num(p, 'g', 0, max) ?? Math.min(d.gpa, max),
    credits: num(p, 'c', 0, 1000) ?? d.credits,
    target: num(p, 't', 0, max) ?? Math.min(d.target, max),
    newCredits: num(p, 'n', 0.5, 1000) ?? d.newCredits,
  };
}
