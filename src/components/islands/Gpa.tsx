import { useEffect, useMemo, useState } from 'preact/hooks';
import scalesData from '../../data/scales.json';
import { semesterGpa, cumulativeGpa, isAverageable, pointsForGrade, parseNum, clamp, fmt, type Scale, type GpaCourse, type CourseKind } from '../../lib/grades';
import { encodeGpa, decodeGpa, uid } from '../../lib/urlstate';
import { loadJson, saveJson } from '../../lib/storage';
import { useDebouncedEffect, useShare } from './shareLink';

const scales = scalesData as unknown as Scale[];
// Only scales with real, ascending grade-point values make sense for the interactive averager.
const usable = scales.filter(isAverageable);
const byslug = (slug: string) => scales.find((s) => s.slug === slug);

interface SavedSemester {
  id: string;
  name: string;
  scale: string;
  weighted: boolean;
  priorGpa: number | null;
  priorCredits: number | null;
  courses: GpaCourse[];
  updated: number;
}

function starter(): SavedSemester {
  return {
    id: uid('sem'),
    name: 'This semester',
    scale: 'us-4-0',
    weighted: false,
    priorGpa: null,
    priorCredits: null,
    courses: [
      { id: uid('g'), name: 'Course 1', grade: 'A', credits: 3 },
      { id: uid('g'), name: 'Course 2', grade: 'B+', credits: 4 },
      { id: uid('g'), name: 'Course 3', grade: 'A-', credits: 3 },
    ],
    updated: Date.now(),
  };
}

const LIST_KEY = 'gpa:semesters';

/** Remap a grade that isn't on `next` to the closest grade by relative position (points / scale max). */
function remapGrade(prev: Scale, next: Scale, grade: string): string {
  if (pointsForGrade(next, grade) != null) return grade;
  const prevPts = pointsForGrade(prev, grade);
  const ratio = prevPts != null && prev.max > 0 ? prevPts / prev.max : 1;
  let best = next.rows[0];
  let bestDiff = Infinity;
  for (const r of next.rows) {
    if (r.points == null) continue;
    const diff = Math.abs((next.max > 0 ? r.points / next.max : 0) - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best?.grade ?? grade;
}

/** Apply a `/gpa-scale/{slug}/` page's preset scale to a base semester, remapping its courses'
 * grades so a scale with a different grade set (e.g. Spain's SB/NT/AP/SU) doesn't leave every
 * course uncounted — the starter/saved courses are always written in `us-4-0` letters. */
function withPreset(base: SavedSemester, presetScale?: string): SavedSemester {
  if (!presetScale || presetScale === base.scale) return presetScale ? { ...base, id: 'draft', scale: presetScale } : base;
  const prevScale = byslug(base.scale) ?? (byslug('us-4-0') as Scale);
  const nextScale = byslug(presetScale) ?? prevScale;
  return { ...base, id: 'draft', scale: presetScale, courses: base.courses.map((c) => ({ ...c, grade: remapGrade(prevScale, nextScale, c.grade) })) };
}

/** Server-safe initial draft: never reads the URL or localStorage, so it matches the SSR markup exactly. */
function serverDraft(presetScale?: string): SavedSemester {
  return withPreset(starter(), presetScale);
}

export default function Gpa({ presetScale }: { presetScale?: string } = {}) {
  const [semesters, setSemesters] = useState<SavedSemester[]>([]);
  const [activeId, setActiveId] = useState('draft');
  const [draft, setDraft] = useState<SavedSemester>(() => serverDraft(presetScale));
  const [msg, setMsg] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const { share, status } = useShare('GradeGoal — my GPA', () =>
    encodeGpa({ scale: draft.scale, weighted: draft.weighted, priorGpa: draft.priorGpa, priorCredits: draft.priorCredits, courses: draft.courses, id: draft.id, name: draft.name }),
  );

  // Apply any URL share or saved localStorage state AFTER mount so the first client render matches SSR
  // (the server never sees window.location or localStorage) — this is what keeps hydration honest.
  useEffect(() => {
    const list = loadJson<SavedSemester[]>(LIST_KEY, []);
    setSemesters(list);
    const shared = decodeGpa(window.location.search, (slug) => usable.some((s) => s.slug === slug), presetScale ?? 'us-4-0');
    let next: SavedSemester;
    if (shared) {
      // The URL carries this saved semester's OWN state (round-tripped there for shareability) when
      // its `id` matches one we have saved — reopen that semester instead of relabelling it "Shared
      // semester" and, on the next Save, duplicating it (N-3, audit 2). An externally shared link (no
      // matching id) still opens as an unsaved draft, as before.
      const own = shared.id ? list.find((s) => s.id === shared.id) : undefined;
      next = own
        ? { ...own, name: shared.name || own.name, scale: shared.scale, weighted: shared.weighted, priorGpa: shared.priorGpa, priorCredits: shared.priorCredits, courses: shared.courses }
        : {
            id: 'draft',
            name: shared.name || 'Shared semester',
            scale: shared.scale,
            weighted: shared.weighted,
            priorGpa: shared.priorGpa,
            priorCredits: shared.priorCredits,
            courses: shared.courses,
            updated: Date.now(),
          };
    } else {
      next = withPreset(list[0] ?? starter(), presetScale);
    }
    setDraft(next);
    setActiveId(next.id);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useDebouncedEffect(() => {
    const url = `${location.pathname}${encodeGpa({ scale: draft.scale, weighted: draft.weighted, priorGpa: draft.priorGpa, priorCredits: draft.priorCredits, courses: draft.courses, id: draft.id, name: draft.name })}`;
    history.replaceState(null, '', url);
  }, [draft]);

  const scale = byslug(draft.scale) ?? (byslug('us-4-0') as Scale);
  const result = useMemo(() => semesterGpa(draft.courses, scale, draft.weighted && Boolean(scale.weighted)), [draft.courses, scale, draft.weighted]);
  const cumulative = useMemo(
    () => (draft.priorGpa != null && draft.priorCredits != null ? cumulativeGpa(draft.priorGpa, draft.priorCredits, result) : null),
    [draft.priorGpa, draft.priorCredits, result],
  );
  const uncounted = draft.courses.length - result.courses.filter((c) => c.counted).length;

  const update = (fn: (s: SavedSemester) => SavedSemester) => setDraft(fn);
  const setCourse = (id: string, patch: Partial<GpaCourse>) => update((s) => ({ ...s, courses: s.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const addCourse = () => update((s) => ({ ...s, courses: [...s.courses, { id: uid('g'), name: `Course ${s.courses.length + 1}`, grade: scale.rows[0]?.grade ?? 'A', credits: 3 }] }));
  const removeCourse = (id: string) => update((s) => ({ ...s, courses: s.courses.filter((c) => c.id !== id) }));

  const saveSemester = () => {
    const now = { ...draft, id: draft.id === 'draft' ? uid('sem') : draft.id, updated: Date.now() };
    setSemesters((list) => {
      const exists = list.some((s) => s.id === now.id);
      const next = exists ? list.map((s) => (s.id === now.id ? now : s)) : [now, ...list];
      saveJson(LIST_KEY, next);
      return next;
    });
    setDraft(now);
    setActiveId(now.id);
    setMsg('Saved to this browser.');
    setTimeout(() => setMsg(''), 2000);
  };
  const newSemester = () => {
    setDraft(starter());
    setActiveId('draft');
  };
  const openSemester = (id: string) => {
    const s = semesters.find((x) => x.id === id);
    if (s) {
      setDraft(s);
      setActiveId(id);
    }
  };
  const deleteSemester = (id: string) => {
    setSemesters((list) => {
      const next = list.filter((s) => s.id !== id);
      saveJson(LIST_KEY, next);
      return next;
    });
    if (activeId === id) newSemester();
  };

  return (
    <div class="tool" data-testid="gpa-calc" data-hydrated={hydrated ? 'true' : 'false'}>
      <div class="course-tabs" role="tablist" aria-label="Saved semesters">
        {semesters.map((s) => (
          <button key={s.id} type="button" class="course-tab" role="tab" aria-selected={activeId === s.id} onClick={() => openSemester(s.id)}>
            {s.name || 'Untitled'}
          </button>
        ))}
        <button type="button" class="course-tab" role="tab" aria-selected={activeId === 'draft'} onClick={newSemester}>
          + New semester
        </button>
      </div>

      <div class="field-grid">
        <div class="field">
          <label for="gpa-name">Semester name</label>
          <input id="gpa-name" type="text" maxLength={60} value={draft.name} onInput={(e) => update((s) => ({ ...s, name: e.currentTarget.value }))} />
        </div>
        <div class="field">
          <label for="gpa-scale">Grading scale</label>
          <select
            id="gpa-scale"
            value={draft.scale}
            onChange={(e) => {
              const nextSlug = e.currentTarget.value;
              const nextScale = byslug(nextSlug) ?? scale;
              update((s) => ({
                ...s,
                scale: nextSlug,
                priorGpa: s.priorGpa != null ? clamp(s.priorGpa, 0, nextScale.max) : s.priorGpa,
                courses: s.courses.map((c) => ({ ...c, grade: remapGrade(scale, nextScale, c.grade) })),
              }));
            }}
          >
            {usable.map((sc) => (
              <option value={sc.slug} key={sc.slug}>
                {sc.name}
              </option>
            ))}
          </select>
        </div>
        {scale.weighted && (
          <div class="field field--inline" style="align-self:end">
            <input id="gpa-weighted" type="checkbox" style="width:auto;min-height:auto" checked={draft.weighted} onChange={(e) => update((s) => ({ ...s, weighted: e.currentTarget.checked }))} />
            <label for="gpa-weighted" style="margin:0">
              Apply Honors/AP weighting
            </label>
          </div>
        )}
      </div>

      {draft.courses.map((c) => (
        <div class="item-row item-row--gpa" key={c.id}>
          <input type="text" aria-label="Course name" maxLength={40} value={c.name} onInput={(e) => setCourse(c.id, { name: e.currentTarget.value })} />
          <select aria-label="Grade" value={c.grade} onChange={(e) => setCourse(c.id, { grade: e.currentTarget.value })}>
            {scale.rows.map((r) => (
              <option value={r.grade} key={r.grade}>
                {r.grade}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="decimal"
            aria-label="Credits"
            min="0"
            max="50"
            step="0.5"
            value={c.credits}
            onInput={(e) => {
              const v = parseNum(e.currentTarget.value);
              if (v != null) setCourse(c.id, { credits: clamp(v, 0, 50) });
            }}
          />
          {scale.weighted && draft.weighted ? (
            <select aria-label="Course level" value={c.kind ?? 'regular'} onChange={(e) => setCourse(c.id, { kind: e.currentTarget.value as CourseKind })}>
              <option value="regular">Regular</option>
              <option value="honors">Honors</option>
              <option value="ap">AP/IB</option>
            </select>
          ) : (
            <span />
          )}
          <button type="button" class="icon-btn icon-btn--danger" onClick={() => removeCourse(c.id)} aria-label={`Remove ${c.name}`}>
            ✕
          </button>
        </div>
      ))}
      <div class="tool__row">
        <button type="button" class="icon-btn" onClick={addCourse}>
          + Add course
        </button>
        <span class="status-msg" role={uncounted > 0 ? 'alert' : 'status'}>
          {draft.courses.length - uncounted} of {draft.courses.length} courses counted
          {uncounted > 0 && ` — ${uncounted} ${uncounted === 1 ? "has a grade or 0 credits that isn't" : "have grades or 0 credits that aren't"} counted on the ${scale.name} scale`}
        </span>
      </div>

      <h2>Cumulative GPA (optional)</h2>
      <div class="field-grid">
        <div class="field">
          <label for="gpa-prior">Prior GPA</label>
          <input
            id="gpa-prior"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="e.g. 3.4"
            value={draft.priorGpa ?? ''}
            onInput={(e) => {
              const raw = e.currentTarget.value;
              if (raw === '') return update((s) => ({ ...s, priorGpa: null }));
              const v = parseNum(raw);
              if (v != null) update((s) => ({ ...s, priorGpa: clamp(v, 0, scale.max) }));
            }}
          />
        </div>
        <div class="field">
          <label for="gpa-prior-cr">Prior credits</label>
          <input
            id="gpa-prior-cr"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            placeholder="e.g. 45"
            value={draft.priorCredits ?? ''}
            onInput={(e) => {
              const raw = e.currentTarget.value;
              if (raw === '') return update((s) => ({ ...s, priorCredits: null }));
              const v = parseNum(raw);
              if (v != null) update((s) => ({ ...s, priorCredits: clamp(v, 0, 1000) }));
            }}
          />
        </div>
      </div>

      <div class="summary-strip">
        <div class="summary-strip__item">
          <strong>{result.gpa != null ? fmt(result.gpa, 3) : '—'}</strong>
          <span>Semester GPA</span>
        </div>
        <div class="summary-strip__item">
          <strong>{cumulative != null ? fmt(cumulative, 3) : '—'}</strong>
          <span>Cumulative GPA</span>
        </div>
        <div class="summary-strip__item">
          <strong>{fmt(result.credits, 1)}</strong>
          <span>Credits counted</span>
        </div>
      </div>

      <div class="tool__actions">
        <button type="button" class="btn" onClick={saveSemester}>
          Save semester
        </button>
        <button type="button" class="btn btn--secondary" onClick={share}>
          Share
        </button>
        {activeId !== 'draft' && (
          <button type="button" class="icon-btn icon-btn--danger" onClick={() => deleteSemester(activeId)}>
            Delete semester
          </button>
        )}
        <span class="status-msg" role="status" aria-live="polite">
          {msg || status}
        </span>
      </div>
    </div>
  );
}
