import { useEffect, useMemo, useState } from 'preact/hooks';
import scalesData from '../../data/scales.json';
import { letterFor, rowForPercent, parseNum, clamp, fmt, cgpaToPercent, percentToCgpa, type Scale } from '../../lib/grades';
import { withBase } from '../../lib/url';
import { useDebouncedEffect, useShare } from './shareLink';

const scales = scalesData as unknown as Scale[];
const PCT_SCALE = scales.find((s) => s.slug === 'percentage-4-0') as Scale;
const rowsByPointsDesc = [...PCT_SCALE.rows].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));

/** Reads one query param on mount only (never during the initial render) so these small converters
 * stay hydration-safe like the other islands — see the note in FinalGrade.tsx. An optional `isValid`
 * rejects a value outside the field's real domain (e.g. a `grade` that isn't one of the scale's own
 * letters) instead of echoing it back into the page unvalidated (N-6, audit 2 — not exploitable since
 * Preact escapes it, but still nonsense reflected text). */
function useUrlText(param: string, fallback: string, isValid?: (v: string) => boolean): [string, (v: string) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(param);
    if (raw) {
      const v = raw.slice(0, 20);
      if (!isValid || isValid(v)) setValue(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useDebouncedEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (value) p.set(param, value);
    else p.delete(param);
    const qs = p.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  }, [value]);
  return [value, setValue];
}

function nearestByPoints(gpa: number) {
  let best = rowsByPointsDesc[0];
  let bestDiff = Infinity;
  for (const r of rowsByPointsDesc) {
    const diff = Math.abs((r.points ?? 0) - gpa);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

export function GpaToPercentage() {
  const [gpa, setGpa] = useUrlText('gpa', '3.7');
  const { share, status } = useShare('GradeGoal — GPA to percentage', () => `?gpa=${encodeURIComponent(gpa)}`);
  const parsed = parseNum(gpa);
  const row = useMemo(() => (parsed != null ? nearestByPoints(clamp(parsed, 0, 4.3)) : null), [parsed]);

  return (
    <div class="tool" data-testid="gpa-to-pct">
      <div class="field-grid">
        <div class="field">
          <label for="g2p-gpa">GPA (4.0 / 4.3 scale)</label>
          <input id="g2p-gpa" type="number" inputMode="decimal" min="0" max="4.3" step="0.01" value={gpa} onInput={(e) => setGpa(e.currentTarget.value)} />
        </div>
      </div>
      <div class="result" data-tone={row ? 'ok' : undefined} role="status" aria-live="polite">
        <p class="result__label">Approximate percentage</p>
        <p class="result__value">{row?.min != null ? `${row.min}–${row.max}%` : '—'}</p>
        <p class="result__verdict">
          A {fmt(parsed ?? 0, 2)} GPA is closest to a <strong>{row?.grade ?? '—'}</strong>, typically {row?.min}–{row?.max}% under a common convention (not any single published standard).
          Individual instructors set their own percentage cutoffs, so treat this as an estimate.
        </p>
      </div>
      <div class="tool__actions">
        <button type="button" class="btn btn--secondary" onClick={share}>
          Share
        </button>
        <span class="status-msg" role="status" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}

export function PercentageToGpa() {
  const [pct, setPct] = useUrlText('pct', '93');
  const { share, status } = useShare('GradeGoal — percentage to GPA', () => `?pct=${encodeURIComponent(pct)}`);
  const parsed = parseNum(pct);
  const clamped = parsed != null ? clamp(parsed, 0, 100) : null;
  const row = clamped != null ? rowForPercent(PCT_SCALE, clamped) : null;
  const letter = clamped != null ? letterFor(clamped) : '—';

  return (
    <div class="tool" data-testid="pct-to-gpa">
      <div class="field-grid">
        <div class="field">
          <label for="p2g-pct">Percentage grade</label>
          <input id="p2g-pct" type="number" inputMode="decimal" min="0" max="100" step="0.1" value={pct} onInput={(e) => setPct(e.currentTarget.value)} />
        </div>
      </div>
      <div class="result" data-tone={row ? 'ok' : undefined} role="status" aria-live="polite">
        <p class="result__label">Letter grade &amp; GPA points</p>
        <p class="result__value">
          {letter} {row?.points != null && <span style="font-size:1.5rem;color:var(--fg-muted)">· {fmt(row.points, 2)} pts</span>}
        </p>
        <p class="result__verdict">
          A {fmt(clamped ?? 0)}% grade is a <strong>{letter}</strong> under a common convention (not any single published standard), worth {row?.points ?? '—'} grade points on the standard
          4.0 scale. Your school's exact cutoffs may differ slightly.
        </p>
      </div>
      <div class="tool__actions">
        <button type="button" class="btn btn--secondary" onClick={share}>
          Share
        </button>
        <span class="status-msg" role="status" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}

export function LetterToGpa() {
  const [letter, setLetter] = useUrlText('grade', 'A-', (v) => PCT_SCALE.rows.some((r) => r.grade === v));
  const { share, status } = useShare('GradeGoal — letter grade to GPA', () => `?grade=${encodeURIComponent(letter)}`);
  const row = PCT_SCALE.rows.find((r) => r.grade === letter);

  return (
    <div class="tool" data-testid="letter-to-gpa">
      <div class="field-grid">
        <div class="field">
          <label for="l2g-letter">Letter grade</label>
          <select id="l2g-letter" value={letter} onChange={(e) => setLetter(e.currentTarget.value)}>
            {PCT_SCALE.rows.map((r) => (
              <option value={r.grade} key={r.grade}>
                {r.grade}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div class="result" data-tone={row ? 'ok' : undefined} role="status" aria-live="polite">
        <p class="result__label">GPA points &amp; percentage</p>
        <p class="result__value">{row?.points != null ? fmt(row.points, 2) : '—'}</p>
        <p class="result__verdict">
          A <strong>{letter}</strong> is worth <strong>{row?.points ?? '—'}</strong> grade points on the standard 4.0 scale
          {row?.min != null ? `, typically ${row.min}–${row.max}%` : ''}. See the <a href={withBase('/gpa-scale/us-4-0/')}>full 4.0 scale table</a> for every grade.
        </p>
      </div>
      <div class="tool__actions">
        <button type="button" class="btn btn--secondary" onClick={share}>
          Share
        </button>
        <span class="status-msg" role="status" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}

export function CgpaConverter() {
  const [cgpa, setCgpa] = useUrlText('cgpa', '8.2');
  const [mode, setMode] = useState<'toPercent' | 'toCgpa'>('toPercent');
  const [hydrated, setHydrated] = useState(false);
  const { share, status } = useShare('GradeGoal — CGPA to percentage', () => `?cgpa=${encodeURIComponent(cgpa)}&dir=${mode}`);
  const val = parseNum(cgpa);
  const out = val == null ? null : mode === 'toPercent' ? cgpaToPercent(clamp(val, 0, 10)) : percentToCgpa(clamp(val, 0, 100));

  useEffect(() => {
    const dir = new URLSearchParams(window.location.search).get('dir');
    if (dir === 'toCgpa') setMode('toCgpa');
    setHydrated(true);
  }, []);

  useDebouncedEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (mode === 'toCgpa') p.set('dir', 'toCgpa');
    else p.delete('dir');
    const qs = p.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  }, [mode]);

  // Switching direction converts the current number into the new mode's units (via the formula),
  // instead of leaving the same digits to be reinterpreted under a different formula — typing "8.2"
  // as a CGPA and then switching to "Percentage → CGPA" used to silently treat that same "8.2" as a
  // percentage, producing a nonsensical result for the number the visitor actually entered.
  const switchMode = (next: 'toPercent' | 'toCgpa') => {
    if (next === mode) return;
    if (out != null) setCgpa(fmt(out, 2));
    setMode(next);
  };

  return (
    <div class="tool" data-testid="cgpa-converter" data-hydrated={hydrated ? 'true' : 'false'}>
      <div class="tool__tabs" role="tablist" aria-label="Direction">
        <button type="button" role="tab" class="tool__tab" aria-selected={mode === 'toPercent'} onClick={() => switchMode('toPercent')}>
          CGPA → Percentage
        </button>
        <button type="button" role="tab" class="tool__tab" aria-selected={mode === 'toCgpa'} onClick={() => switchMode('toCgpa')}>
          Percentage → CGPA
        </button>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="cgpa-in">{mode === 'toPercent' ? 'CGPA (10-point)' : 'Percentage'}</label>
          <input
            id="cgpa-in"
            type="number"
            inputMode="decimal"
            min="0"
            max={mode === 'toPercent' ? 10 : 100}
            step="0.01"
            value={cgpa}
            onInput={(e) => setCgpa(e.currentTarget.value)}
          />
        </div>
      </div>
      <div class="result" data-tone="ok" role="status" aria-live="polite">
        <p class="result__label">{mode === 'toPercent' ? 'Indicative percentage' : 'Indicative CGPA'}</p>
        <p class="result__value">{out != null ? fmt(out, 2) + (mode === 'toPercent' ? '%' : '') : '—'}</p>
        <p class="result__verdict">
          CBSE's own convention (for its Class 10 CCE-era CGPA): <strong>percentage = CGPA × 9.5</strong>. This multiplier is specific to that context — other boards,
          universities and Class 12 marksheets often use a different formula, so check the one printed on your own marksheet.
        </p>
      </div>
      <div class="tool__actions">
        <button type="button" class="btn btn--secondary" onClick={share}>
          Share
        </button>
        <span class="status-msg" role="status" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}
