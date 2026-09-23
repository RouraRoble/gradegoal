import { useEffect, useMemo, useState } from 'preact/hooks';
import { requiredAverage, maxReachable, creditsNeeded, clamp, fmt } from '../../lib/grades';
import { encodePlanner, decodePlanner, PLANNER_DEFAULTS, type PlannerState } from '../../lib/urlstate';
import { useDebouncedEffect, useShare } from './shareLink';
import { useNumberField } from './numberField';

export default function Planner() {
  // Static defaults on first render (server-safe) — see the note in FinalGrade.tsx.
  const [state, setState] = useState<PlannerState>(PLANNER_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const { share, status } = useShare('GradeGoal — my GPA plan', () => encodePlanner(state));

  useEffect(() => {
    setState(decodePlanner(window.location.search));
    setHydrated(true);
  }, []);

  useDebouncedEffect(() => {
    const url = `${location.pathname}${encodePlanner(state)}`;
    history.replaceState(null, '', url);
  }, [state]);

  const set = <K extends keyof PlannerState>(key: K, value: PlannerState[K]) => setState((s) => ({ ...s, [key]: value }));

  const needed = useMemo(() => requiredAverage(state.gpa, state.credits, state.target, state.newCredits), [state.gpa, state.credits, state.target, state.newCredits]);
  const reachable = useMemo(() => maxReachable(state.gpa, state.credits, state.newCredits, state.max), [state.gpa, state.credits, state.newCredits, state.max]);

  const tone: 'secured' | 'ok' | 'hard' | 'impossible' = needed <= state.gpa ? 'secured' : needed > state.max ? 'impossible' : needed > state.max - 0.5 ? 'hard' : 'ok';

  const reachTable = useMemo(() => {
    const options = [10, 20, 30, 45, 60].filter((n) => n !== state.newCredits).slice(0, 4);
    const all = Array.from(new Set([state.newCredits, ...options])).sort((a, b) => a - b);
    return all.map((n) => ({ credits: n, gpa: maxReachable(state.gpa, state.credits, n, state.max) }));
  }, [state.gpa, state.credits, state.newCredits, state.max]);

  const creditsTable = useMemo(() => {
    const avgs = Array.from(new Set([state.max, round1(state.max - 0.3), round1(state.max - 0.7), round1(state.max - 1.0)])).filter((a) => a > 0);
    return avgs.map((avg) => ({ avg, credits: creditsNeeded(state.gpa, state.credits, state.target, avg) }));
  }, [state.gpa, state.credits, state.target, state.max]);

  // See numberField.ts — an uncontrolled input synced imperatively (never while focused) avoids the
  // decimal-typing corruption a directly-controlled number input has (audit P2-1).
  const gpaField = useNumberField(state.gpa, (v) => set('gpa', clamp(v, 0, state.max)));
  const creditsField = useNumberField(state.credits, (v) => set('credits', clamp(v, 0, 1000)));
  const targetField = useNumberField(state.target, (v) => set('target', clamp(v, 0, state.max)));
  const newCreditsField = useNumberField(state.newCredits, (v) => set('newCredits', v));

  return (
    <div class="tool" data-testid="gpa-planner" data-hydrated={hydrated ? 'true' : 'false'}>
      <div class="field-grid">
        <div class="field">
          <label for="pl-gpa">Current GPA</label>
          <input id="pl-gpa" type="number" inputMode="decimal" min="0" max={state.max} step="0.01" ref={gpaField.ref} defaultValue={gpaField.defaultValue} onInput={gpaField.onInput} onBlur={gpaField.onBlur} />
        </div>
        <div class="field">
          <label for="pl-credits">Credits earned so far</label>
          <input id="pl-credits" type="number" inputMode="decimal" min="0" step="0.5" ref={creditsField.ref} defaultValue={creditsField.defaultValue} onInput={creditsField.onInput} onBlur={creditsField.onBlur} />
        </div>
        <div class="field">
          <label for="pl-target">Target GPA</label>
          <input id="pl-target" type="number" inputMode="decimal" min="0" max={state.max} step="0.01" ref={targetField.ref} defaultValue={targetField.defaultValue} onInput={targetField.onInput} onBlur={targetField.onBlur} />
        </div>
        <div class="field">
          <label for="pl-new">Credits to earn it in</label>
          <input
            id="pl-new"
            type="number"
            inputMode="decimal"
            min="0.5"
            step="0.5"
            ref={newCreditsField.ref}
            defaultValue={newCreditsField.defaultValue}
            onInput={newCreditsField.onInput}
            onBlur={(e) => {
              newCreditsField.onBlur(e);
              set('newCredits', clamp(state.newCredits, 0.5, 1000));
            }}
          />
        </div>
        <div class="field">
          <label for="pl-max">Scale maximum</label>
          <select
            id="pl-max"
            value={state.max}
            onChange={(e) => {
              const max = Number(e.currentTarget.value);
              setState((s) => ({ ...s, max, gpa: Math.min(s.gpa, max), target: Math.min(s.target, max) }));
            }}
          >
            <option value="4">4.0</option>
            <option value="4.3">4.3</option>
            <option value="5">5.0</option>
            <option value="7">7.0 (Australia)</option>
            <option value="10">10 (India / Spain)</option>
          </select>
        </div>
      </div>

      <div class="result" data-tone={tone} role="status" aria-live="polite">
        <p class="result__label">
          <span class="badge" data-tone={tone}>
            {tone === 'secured' ? 'Already there' : tone === 'impossible' ? 'Not possible' : tone === 'hard' ? 'Ambitious' : 'Doable'}
          </span>
        </p>
        <p class="result__value">{Number.isFinite(needed) ? fmt(tone === 'secured' ? Math.max(needed, 0) : needed, 2) : '—'}</p>
        <p class="result__verdict">
          {tone === 'secured'
            ? `Your GPA is already at or above ${fmt(state.target, 2)} — any average over your next ${fmt(state.newCredits, 1)} credits keeps you there or higher.`
            : tone === 'impossible'
              ? `Even a perfect ${fmt(state.max, 1)} average over ${fmt(state.newCredits, 1)} credits only reaches ${fmt(reachable, 2)} — you'd need more credits.`
              : `You need to average ${fmt(needed, 2)} over your next ${fmt(state.newCredits, 1)} credits to reach ${fmt(state.target, 2)}.`}
        </p>
      </div>

      <h2>What GPA could you reach?</h2>
      <p class="field__hint">If you averaged a perfect {fmt(state.max, 1)} from here on:</p>
      <div class="table-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th scope="col">Additional credits</th>
              <th scope="col">Best possible cumulative GPA</th>
            </tr>
          </thead>
          <tbody>
            {reachTable.map((r) => (
              <tr key={r.credits}>
                <td>{fmt(r.credits, 1)}</td>
                <td>{fmt(r.gpa, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Credits needed to reach {fmt(state.target, 2)}</h2>
      <div class="table-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th scope="col">If you average</th>
              <th scope="col">Credits needed</th>
            </tr>
          </thead>
          <tbody>
            {creditsTable.map((r) => (
              <tr key={r.avg}>
                <td>{fmt(r.avg, 2)}</td>
                <td data-tone={r.credits == null ? 'impossible' : undefined}>{r.credits == null ? 'Never at this average' : `${fmt(r.credits, 1)} credits`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="tool__actions">
        <button type="button" class="btn" onClick={share}>
          Share this plan
        </button>
        <span class="status-msg" role="status" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 100) / 100;
}
