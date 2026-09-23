import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { courseGrade, parseNum, clamp, fmt, type Category, type AverageMethod, type GradeItem } from '../../lib/grades';
import { encodeGradeBook, decodeGradeBook, uid } from '../../lib/urlstate';
import { loadJson, saveJson } from '../../lib/storage';
import { useDebouncedEffect, useShare } from './shareLink';

interface SavedCourse {
  id: string;
  name: string;
  term: string;
  method: AverageMethod;
  categories: Category[];
  updated: number;
}

function blankCategory(n: number): Category {
  return { id: uid('c'), name: `Category ${n}`, weight: n === 1 ? 100 : 0, drop: 0, items: [] };
}

function starterCourse(): SavedCourse {
  return {
    id: uid('course'),
    name: 'My course',
    term: '',
    method: 'points',
    categories: [
      { id: uid('c'), name: 'Homework', weight: 20, drop: 1, items: [{ id: uid('i'), name: 'HW 1', score: 9, possible: 10 }] },
      { id: uid('c'), name: 'Exams', weight: 50, drop: 0, items: [{ id: uid('i'), name: 'Midterm', score: 85, possible: 100 }] },
      { id: uid('c'), name: 'Final', weight: 30, drop: 0, items: [] },
    ],
    updated: Date.now(),
  };
}

const LIST_KEY = 'gradebook:courses';

/** JSON fingerprint of the fields a "you have unsaved changes" check cares about (not `updated` or
 * any `id`s — category/item ids are freshly regenerated every time a course round-trips through the
 * URL, so comparing them would make an untouched reload look "dirty"). */
const fingerprint = (c: SavedCourse) =>
  JSON.stringify({
    name: c.name,
    term: c.term,
    method: c.method,
    categories: c.categories.map((cat) => ({
      name: cat.name,
      weight: cat.weight,
      drop: cat.drop,
      items: cat.items.map((it) => ({ name: it.name, score: it.score, possible: it.possible, hypothetical: it.hypothetical })),
    })),
  });

export default function GradeBook() {
  // Server-safe: never reads the URL or localStorage on first render — see the note in FinalGrade.tsx.
  const [courses, setCourses] = useState<SavedCourse[]>([]);
  const [activeId, setActiveId] = useState<string>('draft');
  const [draft, setDraft] = useState<SavedCourse>(() => starterCourse());
  const [teacherLink, setTeacherLink] = useState('');
  const [msg, setMsg] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const savedFingerprint = useRef(fingerprint(draft));
  const { share, status } = useShare('GradeGoal — my weighted grade', () =>
    encodeGradeBook({ name: draft.name, term: draft.term, categories: draft.categories, method: draft.method }, true),
  );

  const loadCourse = (course: SavedCourse, id: string) => {
    setDraft(course);
    setActiveId(id);
    savedFingerprint.current = fingerprint(course);
  };

  const confirmDiscard = () => savedFingerprint.current === fingerprint(draft) || window.confirm('Discard your unsaved changes to this course?');

  useEffect(() => {
    const list = loadJson<SavedCourse[]>(LIST_KEY, []);
    setCourses(list);
    const shared = decodeGradeBook(window.location.search);
    if (shared) {
      // Reloading a course we already saved re-encodes its own state into the URL (so the address
      // bar stays a valid share link). Recognise that case by id and reopen the SAVED course instead
      // of treating it as a brand-new 'draft' — which used to duplicate the course on the next Save
      // and drop its term.
      const own = shared.id ? list.find((c) => c.id === shared.id) : undefined;
      if (own) {
        // The URL carries this saved course's own state (we wrote it there for shareability), but it
        // may be an EDITED copy — e.g. this same tab reloading after an unsaved change, or the saver
        // reopening their own "what-if" link. Show the edited values, but keep the fingerprint of the
        // SAVED course so the edit still shows as dirty (and "Save course" persists it) instead of
        // being silently discarded on reload (N-2, audit 2).
        const editedDraft: SavedCourse = { id: own.id, name: shared.name || own.name, term: shared.term || own.term, method: shared.method, categories: shared.categories, updated: own.updated };
        setDraft(editedDraft);
        setActiveId(own.id);
        savedFingerprint.current = fingerprint(own);
      } else {
        loadCourse({ id: 'draft', name: shared.name || 'Shared course', term: shared.term || '', method: shared.method, categories: shared.categories, updated: Date.now() }, 'draft');
      }
    } else if (list[0]) {
      loadCourse(list[0], list[0].id);
    } else {
      savedFingerprint.current = fingerprint(draft);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useDebouncedEffect(() => {
    const url = `${location.pathname}${encodeGradeBook({ name: draft.name, term: draft.term, id: draft.id, categories: draft.categories, method: draft.method }, true)}`;
    history.replaceState(null, '', url);
  }, [draft]);

  const result = useMemo(() => courseGrade(draft.categories, draft.method), [draft.categories, draft.method]);

  const update = (fn: (c: SavedCourse) => SavedCourse) => setDraft((c) => fn(c));

  const setCategory = (id: string, patch: Partial<Category>) =>
    update((c) => ({ ...c, categories: c.categories.map((cat) => (cat.id === id ? { ...cat, ...patch } : cat)) }));

  const addCategory = () => update((c) => ({ ...c, categories: [...c.categories, blankCategory(c.categories.length + 1)] }));
  const removeCategory = (id: string) => update((c) => ({ ...c, categories: c.categories.filter((cat) => cat.id !== id) }));

  const addItem = (catId: string, hypothetical = false) =>
    update((c) => ({
      ...c,
      categories: c.categories.map((cat) =>
        cat.id === catId
          ? { ...cat, items: [...cat.items, { id: uid('i'), name: hypothetical ? 'What if…' : `Item ${cat.items.length + 1}`, score: hypothetical ? 90 : null, possible: 100, hypothetical } as GradeItem] }
          : cat,
      ),
    }));
  const setItem = (catId: string, itemId: string, patch: Partial<GradeItem>) =>
    update((c) => ({
      ...c,
      categories: c.categories.map((cat) => (cat.id === catId ? { ...cat, items: cat.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) } : cat)),
    }));
  const removeItem = (catId: string, itemId: string) =>
    update((c) => ({ ...c, categories: c.categories.map((cat) => (cat.id === catId ? { ...cat, items: cat.items.filter((it) => it.id !== itemId) } : cat)) }));

  const saveCourse = () => {
    const now = { ...draft, id: draft.id === 'draft' ? uid('course') : draft.id, updated: Date.now() };
    setCourses((list) => {
      const exists = list.some((c) => c.id === now.id);
      const next = exists ? list.map((c) => (c.id === now.id ? now : c)) : [now, ...list];
      saveJson(LIST_KEY, next);
      return next;
    });
    loadCourse(now, now.id);
    setMsg('Saved to this browser.');
    setTimeout(() => setMsg(''), 2000);
  };

  const newCourse = () => {
    if (!confirmDiscard()) return;
    loadCourse(starterCourse(), 'draft');
  };

  const openCourse = (id: string) => {
    if (!confirmDiscard()) return;
    const c = courses.find((x) => x.id === id);
    if (c) loadCourse(c, id);
  };

  const deleteCourse = (id: string) => {
    const course = courses.find((c) => c.id === id);
    if (!window.confirm(`Delete "${course?.name || 'this course'}"? This can't be undone.`)) return;
    setCourses((list) => {
      const next = list.filter((c) => c.id !== id);
      saveJson(LIST_KEY, next);
      return next;
    });
    if (activeId === id) loadCourse(starterCourse(), 'draft');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(draft.name || 'course').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Reject absurdly large files before even reading them (JSON.parse on megabytes of text can hang
   * the tab, and no real course export is anywhere near this size). */
  const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

  const importJson = (file: File) => {
    if (file.size > IMPORT_MAX_BYTES) {
      setMsg('That file is too large to import (2 MB max).');
      setTimeout(() => setMsg(''), 3000);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.categories)) throw new Error('bad file');
        setDraft({
          id: 'draft',
          name: String(data.name ?? 'Imported course').slice(0, 60),
          term: String(data.term ?? '').slice(0, 40),
          method: data.method === 'equal' ? 'equal' : 'points',
          categories: data.categories.slice(0, 20).map((cat: Category) => ({
            id: uid('c'),
            name: String(cat.name ?? 'Category').slice(0, 40),
            weight: clamp(cat.weight, 0, 100),
            drop: Math.floor(clamp(cat.drop ?? 0, 0, 20)),
            items: (cat.items ?? []).slice(0, 60).map((it: GradeItem) => ({
              id: uid('i'),
              name: String(it.name ?? 'Item').slice(0, 40),
              score: it.score == null ? null : clamp(it.score, 0, 1e6),
              possible: clamp(it.possible ?? 100, 0.01, 1e6),
              hypothetical: Boolean(it.hypothetical),
            })),
          })),
          updated: Date.now(),
        });
        setActiveId('draft');
        setMsg('Imported.');
        setTimeout(() => setMsg(''), 2000);
      } catch {
        setMsg('That file could not be read.');
        setTimeout(() => setMsg(''), 3000);
      }
    };
    reader.readAsText(file);
  };

  const copyTeacherLink = async () => {
    const link = `${location.origin}${location.pathname}${encodeGradeBook({ name: draft.name, categories: draft.categories, method: draft.method }, false)}`;
    setTeacherLink(link);
    try {
      await navigator.clipboard.writeText(link);
      setMsg('Teacher link copied (no scores included).');
    } catch {
      setMsg('Teacher link ready below.');
    }
    setTimeout(() => setMsg(''), 3000);
  };

  const weightTotal = draft.categories.reduce((a, c) => a + (Number.isFinite(c.weight) ? c.weight : 0), 0);
  const weightOk = Math.abs(weightTotal - 100) < 0.01;

  return (
    <div class="tool" data-testid="grade-book" data-hydrated={hydrated ? 'true' : 'false'}>
      <div class="course-tabs" role="tablist" aria-label="Saved courses">
        {courses.map((c) => (
          <button key={c.id} type="button" class="course-tab" role="tab" aria-selected={activeId === c.id} onClick={() => openCourse(c.id)}>
            {c.name || 'Untitled'}
          </button>
        ))}
        <button type="button" class="course-tab" role="tab" aria-selected={activeId === 'draft'} onClick={newCourse}>
          + New course
        </button>
      </div>

      <div class="field-grid">
        <div class="field">
          <label for="gb-name">Course name</label>
          <input id="gb-name" type="text" maxLength={60} value={draft.name} onInput={(e) => update((c) => ({ ...c, name: e.currentTarget.value }))} />
        </div>
        <div class="field">
          <label for="gb-term">Term (optional)</label>
          <input id="gb-term" type="text" maxLength={40} value={draft.term} onInput={(e) => update((c) => ({ ...c, term: e.currentTarget.value }))} />
        </div>
        <div class="field">
          <label for="gb-method">Category averaging</label>
          <select id="gb-method" value={draft.method} onChange={(e) => update((c) => ({ ...c, method: e.currentTarget.value === 'equal' ? 'equal' : 'points' }))}>
            <option value="points">Weighted by points</option>
            <option value="equal">Equal weight per item</option>
          </select>
        </div>
      </div>

      <div class="summary-strip">
        <div class="summary-strip__item">
          <strong>{result.current != null ? `${fmt(result.current)}%` : '—'}</strong>
          <span>Current grade</span>
        </div>
        <div class="summary-strip__item">
          <strong>{result.projected != null ? `${fmt(result.projected)}%` : '—'}</strong>
          <span>With what-ifs</span>
        </div>
        <div class="summary-strip__item">
          <strong style={!weightOk ? 'color:var(--danger)' : undefined}>{fmt(weightTotal)}%</strong>
          <span>Weights total{!weightOk ? ' (should be 100%)' : ''}</span>
        </div>
      </div>

      {draft.categories.map((cat) => {
        const catResult = result.categories.find((r) => r.id === cat.id);
        return (
          <div class="category" key={cat.id}>
            <div class="category__head">
              <div class="field">
                <label for={`cat-name-${cat.id}`}>Category</label>
                <input id={`cat-name-${cat.id}`} type="text" maxLength={40} value={cat.name} onInput={(e) => setCategory(cat.id, { name: e.currentTarget.value })} />
              </div>
              <div class="field" style="max-width:7rem">
                <label for={`cat-weight-${cat.id}`}>Weight (%)</label>
                <input
                  id={`cat-weight-${cat.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.5"
                  value={cat.weight}
                  onInput={(e) => {
                    const v = parseNum(e.currentTarget.value);
                    if (v != null) setCategory(cat.id, { weight: clamp(v, 0, 100) });
                  }}
                />
              </div>
              <div class="field" style="max-width:6rem">
                <label for={`cat-drop-${cat.id}`}>Drop lowest</label>
                <input
                  id={`cat-drop-${cat.id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="20"
                  step="1"
                  value={cat.drop}
                  onInput={(e) => {
                    const v = parseNum(e.currentTarget.value);
                    if (v != null) setCategory(cat.id, { drop: Math.floor(clamp(v, 0, 20)) });
                  }}
                />
              </div>
              {draft.categories.length > 1 && (
                <button type="button" class="icon-btn icon-btn--danger" onClick={() => removeCategory(cat.id)} aria-label={`Remove category ${cat.name}`}>
                  Remove
                </button>
              )}
            </div>

            {cat.items.map((it) => (
              <div class="item-row" key={it.id}>
                <input
                  type="text"
                  aria-label="Item name"
                  maxLength={40}
                  value={it.name}
                  onInput={(e) => setItem(cat.id, it.id, { name: e.currentTarget.value })}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label="Score earned"
                  placeholder="score"
                  value={it.score ?? ''}
                  onInput={(e) => {
                    const raw = e.currentTarget.value;
                    if (raw === '') return setItem(cat.id, it.id, { score: null });
                    const v = parseNum(raw);
                    if (v != null) setItem(cat.id, it.id, { score: clamp(v, 0, 1e6) });
                  }}
                />
                <span class="item-row__sep" aria-hidden="true">
                  /
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label="Points possible"
                  value={it.possible}
                  onInput={(e) => {
                    const v = parseNum(e.currentTarget.value);
                    if (v != null) setItem(cat.id, it.id, { possible: v });
                  }}
                  onBlur={() => setItem(cat.id, it.id, { possible: clamp(it.possible, 0.01, 1e6) })}
                />
                <button type="button" class="icon-btn icon-btn--danger" onClick={() => removeItem(cat.id, it.id)} aria-label={`Remove ${it.name}`}>
                  ✕
                </button>
              </div>
            ))}
            <div class="tool__row">
              <button type="button" class="icon-btn" onClick={() => addItem(cat.id)}>
                + Add grade
              </button>
              <button type="button" class="icon-btn" onClick={() => addItem(cat.id, true)}>
                + Add what-if
              </button>
              {catResult && (
                <span class="status-msg">
                  {catResult.average != null ? `Average: ${fmt(catResult.average)}%` : 'No grades yet'}
                  {catResult.dropped.length ? ` · dropped ${catResult.dropped.length}` : ''}
                </span>
              )}
            </div>
          </div>
        );
      })}

      <div class="tool__actions">
        <button type="button" class="btn btn--secondary" onClick={addCategory}>
          + Add category
        </button>
      </div>

      <div class="tool__actions">
        <button type="button" class="btn" onClick={saveCourse}>
          Save course
        </button>
        <button type="button" class="icon-btn" onClick={exportJson}>
          Export JSON
        </button>
        <button type="button" class="icon-btn" onClick={() => fileInput.current?.click()}>
          Import JSON
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          aria-label="Import course from a JSON file"
          class="visually-hidden-label"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) importJson(f);
            e.currentTarget.value = '';
          }}
        />
        <button type="button" class="icon-btn" onClick={() => window.print()}>
          Print
        </button>
        {activeId !== 'draft' && (
          <button type="button" class="icon-btn icon-btn--danger" onClick={() => deleteCourse(activeId)}>
            Delete course
          </button>
        )}
      </div>

      <div class="tool__actions">
        <button type="button" class="btn btn--secondary" onClick={copyTeacherLink}>
          Copy teacher link (categories only, no scores)
        </button>
        <button type="button" class="btn btn--secondary" onClick={share}>
          Share full result
        </button>
        <span class="status-msg" role="status" aria-live="polite">
          {msg || status}
        </span>
      </div>
      {teacherLink && (
        <p class="field__hint" style="word-break:break-all">
          {teacherLink}
        </p>
      )}
    </div>
  );
}
