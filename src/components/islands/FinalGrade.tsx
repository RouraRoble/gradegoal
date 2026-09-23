import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  neededOnFinal,
  feasibility,
  FEASIBILITY_LABEL,
  targetTable,
  neededReplacingLowest,
  neededTwoPartFinal,
  neededPoints,
  parseNum,
  clamp,
  fmt,
  type Feasibility,
} from '../../lib/grades';
import { encodeFinal, decodeFinal, FINAL_DEFAULTS, type FinalMode, type FinalState } from '../../lib/urlstate';
import { useDebouncedEffect, useShare } from './shareLink';
import { useNumberField } from './numberField';

const TABS: { id: FinalMode; label: string }[] = [
  { id: 'basic', label: 'Standard' },
  { id: 'lowest', label: 'Final replaces lowest test' },
  { id: 'two', label: 'Two-part final' },
  { id: 'points', label: 'Points-based' },
];

function verdictSentence(needed: number, target: number, tone: Feasibility): string {
  if (tone === 'secured') return `Your grade is already secured — you could score 0 on the final and still get at least ${fmt(target)}%.`;
  if (tone === 'impossible') return `Reaching ${fmt(target)}% is not possible on this final — the highest score (100%) still leaves you short.`;
  return `You need ${fmt(Math.max(needed, 0))}% on your final to get ${fmt(target)}% overall.`;
}

export default function FinalGrade() {
  // Always start from the same, static defaults the server rendered — reading the URL or
  // localStorage here would make the first client render diverge from the SSR markup and
  // corrupt Preact's hydration (inputs, tabs and results would all go out of sync).
  const [state, setState] = useState<FinalState>(FINAL_DEFAULTS);
  const [testsRaw, setTestsRaw] = useState(() => FINAL_DEFAULTS.tests.join(', '));
  const [hydrated, setHydrated] = useState(false);
  const { share, status } = useShare('GradeGoal — what I need on my final', () => encodeFinal(state));

  // Apply the real URL state once, after mount — this runs strictly after hydration finishes,
  // so it's a normal re-render, not a hydration diff.
  useEffect(() => {
    const decoded = decodeFinal(window.location.search);
    setState(decoded);
    setTestsRaw(decoded.tests.join(', '));
    setHydrated(true);
  }, []);

  useDebouncedEffect(() => {
    const url = `${location.pathname}${encodeFinal(state)}`;
    history.replaceState(null, '', url);
  }, [state]);

  const set = <K extends keyof FinalState>(key: K, value: FinalState[K]) => setState((s) => ({ ...s, [key]: value }));

  const basic = useMemo(() => {
    const needed = neededOnFinal(state.current, state.weight, state.target);
    const tone = feasibility(needed);
    return { needed, tone, table: targetTable(state.current, state.weight) };
  }, [state.current, state.weight, state.target]);

  const lowest = useMemo(() => neededReplacingLowest({ tests: state.tests, target: state.target, testsWeightPct: state.testsWeight, otherGrade: state.other }), [
    state.tests,
    state.target,
    state.testsWeight,
    state.other,
  ]);

  const twoWeightsInvalid = state.weight1 + state.weight2 > 100;
  const two = useMemo(
    () => neededTwoPartFinal({ current: state.current, weight1Pct: state.weight1, weight2Pct: state.weight2, target: state.target, part1Score: state.part1 }),
    [state.current, state.weight1, state.weight2, state.target, state.part1],
  );

  const points = useMemo(() => neededPoints({ earned: state.earned, possible: state.possible, finalPoints: state.finalPoints, target: state.target }), [
    state.earned,
    state.possible,
    state.finalPoints,
    state.target,
  ]);

  const parseTests = (raw: string) =>
    raw
      .split(',')
      .map((t) => parseNum(t))
      .filter((v): v is number => v != null)
      .map((v) => clamp(v, 0, 200))
      .slice(0, 30);

  // Parse on every keystroke (not just on blur): the tests list has no minimum-clamp-while-typing
  // hazard (unlike the weight fields, see numberField.ts), so the result can update live and the
  // Share button never jumps out from under a click right after typing (N-1, audit 2).
  const onTestsInput = (raw: string) => {
    setTestsRaw(raw);
    const tests = parseTests(raw);
    set('tests', tests.length ? tests : FINAL_DEFAULTS.tests);
  };

  // Each of these is bound to a field that can appear in more than one tab's markup (e.g.
  // "current" in both Standard and Two-part), but only one tab is ever mounted at a time, so one
  // hook instance — and its one DOM ref — safely serves whichever input is currently rendered.
  // See numberField.ts for why this replaces a plain `value={...} onInput={...}` binding: typing a
  // decimal like "0.5" into a directly-controlled number input used to get corrupted mid-keystroke.
  const currentField = useNumberField(state.current, (v) => set('current', clamp(v, 0, 200)));
  const weightField = useNumberField(state.weight, (v) => set('weight', v));
  const targetField = useNumberField(state.target, (v) => set('target', clamp(v, 0, 200)));
  const testsWeightField = useNumberField(state.testsWeight, (v) => set('testsWeight', v));
  const otherField = useNumberField(state.other, (v) => set('other', clamp(v, 0, 200)));
  const weight1Field = useNumberField(state.weight1, (v) => set('weight1', v));
  const weight2Field = useNumberField(state.weight2, (v) => set('weight2', v));
  const earnedField = useNumberField(state.earned, (v) => set('earned', clamp(v, 0, 1e6)));
  const possibleField = useNumberField(state.possible, (v) => set('possible', clamp(v, 0, 1e6)));
  const finalPointsField = useNumberField(state.finalPoints, (v) => set('finalPoints', clamp(v, 0, 1e6)));

  return (
    <div class="tool" data-testid="final-grade" data-hydrated={hydrated ? 'true' : 'false'}>
      <div class="tool__tabs" role="tablist" aria-label="Final grade calculation method">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            class="tool__tab"
            aria-selected={state.mode === t.id}
            onClick={() => set('mode', t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {state.mode === 'basic' && (
        <section aria-label="Standard final grade inputs">
          <div class="field-grid">
            <div class="field">
              <label for="fg-current">Current grade (%)</label>
              <input id="fg-current" type="number" inputMode="decimal" min="0" max="200" step="0.1" ref={currentField.ref} defaultValue={currentField.defaultValue} onInput={currentField.onInput} onBlur={currentField.onBlur} />
            </div>
            <div class="field">
              <label for="fg-weight">Final's weight (%)</label>
              <input
                id="fg-weight"
                type="number"
                inputMode="decimal"
                min="0.01"
                max="100"
                step="0.1"
                ref={weightField.ref}
                defaultValue={weightField.defaultValue}
                onInput={weightField.onInput}
                onBlur={(e) => {
                  weightField.onBlur(e);
                  set('weight', clamp(state.weight, 0.01, 100));
                }}
              />
            </div>
            <div class="field">
              <label for="fg-target">Target grade (%)</label>
              <input id="fg-target" type="number" inputMode="decimal" min="0" max="200" step="0.1" ref={targetField.ref} defaultValue={targetField.defaultValue} onInput={targetField.onInput} onBlur={targetField.onBlur} />
            </div>
          </div>

          <div class="result" data-tone={basic.tone} role="status" aria-live="polite">
            <p class="result__label">
              <span class="badge" data-tone={basic.tone}>
                {FEASIBILITY_LABEL[basic.tone]}
              </span>
            </p>
            <p class="result__value">{Number.isFinite(basic.needed) ? `${fmt(Math.max(basic.needed, 0))}%` : '—'}</p>
            <p class="result__verdict">{verdictSentence(basic.needed, state.target, basic.tone)}</p>
          </div>

          <h2>Score needed for every letter grade</h2>
          <div class="table-wrap">
            <table class="matrix">
              <thead>
                <tr>
                  <th scope="col">Target</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Score needed on final</th>
                </tr>
              </thead>
              <tbody>
                {basic.table.map((row) => (
                  <tr key={row.letter}>
                    <td>{row.target}%</td>
                    <td>{row.letter}</td>
                    <td data-tone={row.feasibility}>{Number.isFinite(row.needed) ? `${fmt(Math.max(row.needed, 0))}%` : '—'} · {FEASIBILITY_LABEL[row.feasibility]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {state.mode === 'lowest' && (
        <section aria-label="Final replaces lowest test inputs">
          <div class="field">
            <label for="fg-tests">Test scores so far (comma-separated)</label>
            <input
              id="fg-tests"
              type="text"
              inputMode="decimal"
              value={testsRaw}
              onInput={(e) => onTestsInput(e.currentTarget.value)}
            />
            <p class="field__hint">The final counts as one more test and replaces whichever score is lowest.</p>
          </div>
          <div class="field-grid" style="margin-top:1rem">
            <div class="field">
              <label for="fg-tw">Tests' share of course grade (%)</label>
              <input
                id="fg-tw"
                type="number"
                inputMode="decimal"
                min="0.01"
                max="100"
                step="0.1"
                ref={testsWeightField.ref}
                defaultValue={testsWeightField.defaultValue}
                onInput={testsWeightField.onInput}
                onBlur={(e) => {
                  testsWeightField.onBlur(e);
                  set('testsWeight', clamp(state.testsWeight, 0.01, 100));
                }}
              />
            </div>
            {state.testsWeight < 100 && (
              <div class="field">
                <label for="fg-other">Rest of the grade (%)</label>
                <input id="fg-other" type="number" inputMode="decimal" min="0" max="200" step="0.1" ref={otherField.ref} defaultValue={otherField.defaultValue} onInput={otherField.onInput} onBlur={otherField.onBlur} />
              </div>
            )}
            <div class="field">
              <label for="fg-target-l">Target grade (%)</label>
              <input id="fg-target-l" type="number" inputMode="decimal" min="0" max="200" step="0.1" ref={targetField.ref} defaultValue={targetField.defaultValue} onInput={targetField.onInput} onBlur={targetField.onBlur} />
            </div>
          </div>

          {(() => {
            const tone = lowest.alreadyDecided ? (lowest.resultingIfDropped >= state.target ? 'secured' : 'impossible') : feasibility(lowest.needed);
            return (
              <div class="result" data-tone={tone} role="status" aria-live="polite">
                <p class="result__label">
                  <span class="badge" data-tone={tone}>
                    {FEASIBILITY_LABEL[tone]}
                  </span>
                </p>
                {lowest.alreadyDecided ? (
                  <>
                    <p class="result__value">{fmt(lowest.resultingIfDropped)}%</p>
                    <p class="result__verdict">
                      {tone === 'secured' ? (
                        <>
                          You already have at least <strong>{fmt(lowest.resultingIfDropped)}%</strong> locked in — score at or below your current lowest test and the final
                          just gets dropped as the new lowest, leaving your average unchanged. Score <em>higher</em> than your current lowest test and the final would
                          replace a different, higher test instead, raising your grade above {fmt(lowest.resultingIfDropped)}%.
                        </>
                      ) : (
                        <>
                          Based on your current tests, reaching {fmt(state.target)}% isn't possible this way — double-check your target, test scores and weights.
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <p class="result__value">{Number.isFinite(lowest.needed) ? `${fmt(Math.max(lowest.needed, 0))}%` : '—'}</p>
                    <p class="result__verdict">{verdictSentence(lowest.needed, state.target, tone)} Current test average: {fmt(lowest.currentAverage)}%.</p>
                  </>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {state.mode === 'two' && (
        <section aria-label="Two-part final inputs">
          <div class="field-grid">
            <div class="field">
              <label for="fg-current2">Current grade (%)</label>
              <input id="fg-current2" type="number" inputMode="decimal" min="0" max="200" step="0.1" ref={currentField.ref} defaultValue={currentField.defaultValue} onInput={currentField.onInput} onBlur={currentField.onBlur} />
            </div>
            <div class="field">
              <label for="fg-w1">Part 1 weight (%)</label>
              <input
                id="fg-w1"
                type="number"
                inputMode="decimal"
                min="0.01"
                max="100"
                step="0.1"
                ref={weight1Field.ref}
                defaultValue={weight1Field.defaultValue}
                onInput={weight1Field.onInput}
                onBlur={(e) => {
                  weight1Field.onBlur(e);
                  set('weight1', clamp(state.weight1, 0.01, 100));
                }}
              />
            </div>
            <div class="field">
              <label for="fg-w2">Part 2 weight (%)</label>
              <input
                id="fg-w2"
                type="number"
                inputMode="decimal"
                min="0.01"
                max="100"
                step="0.1"
                ref={weight2Field.ref}
                defaultValue={weight2Field.defaultValue}
                onInput={weight2Field.onInput}
                onBlur={(e) => {
                  weight2Field.onBlur(e);
                  set('weight2', clamp(state.weight2, 0.01, 100));
                }}
              />
            </div>
            <div class="field">
              <label for="fg-p1">Part 1 score (%, optional)</label>
              <input
                id="fg-p1"
                type="number"
                inputMode="decimal"
                min="0"
                max="200"
                step="0.1"
                placeholder="Not taken yet"
                value={state.part1 ?? ''}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  if (raw === '') return set('part1', null);
                  const v = parseNum(raw);
                  if (v != null) set('part1', v);
                }}
                onBlur={() => {
                  if (state.part1 != null) set('part1', clamp(state.part1, 0, 200));
                }}
              />
            </div>
            <div class="field">
              <label for="fg-target3">Target grade (%)</label>
              <input id="fg-target3" type="number" inputMode="decimal" min="0" max="200" step="0.1" ref={targetField.ref} defaultValue={targetField.defaultValue} onInput={targetField.onInput} onBlur={targetField.onBlur} />
            </div>
          </div>
          {twoWeightsInvalid ? (
            <div class="result" data-tone="impossible" role="alert">
              <p class="result__label">
                <span class="badge" data-tone="impossible">
                  Check the weights
                </span>
              </p>
              <p class="result__verdict">
                Part 1 and Part 2 weights add up to {fmt(state.weight1 + state.weight2)}%, which is more than 100% of the course. Lower one of them so they total 100% or
                less.
              </p>
            </div>
          ) : (
            (() => {
              const tone = feasibility(two.needed);
              return (
                <div class="result" data-tone={tone} role="status" aria-live="polite">
                  <p class="result__label">
                    <span class="badge" data-tone={tone}>
                      {FEASIBILITY_LABEL[tone]}
                    </span>
                  </p>
                  <p class="result__value">{Number.isFinite(two.needed) ? `${fmt(Math.max(two.needed, 0))}%` : '—'}</p>
                  <p class="result__verdict">
                    {tone === 'secured'
                      ? `You've already secured ${fmt(state.target)}% overall no matter what you score on ${two.mode === 'part2' ? 'part 2' : 'the rest of the final'}.`
                      : two.mode === 'part2'
                        ? `You need ${fmt(Math.max(two.needed, 0))}% on part 2 to reach ${fmt(state.target)}% overall.`
                        : `You need ${fmt(Math.max(two.needed, 0))}% on both parts (assuming an equal score) to reach ${fmt(state.target)}% overall.`}
                  </p>
                </div>
              );
            })()
          )}
        </section>
      )}

      {state.mode === 'points' && (
        <section aria-label="Points-based final inputs">
          <div class="field-grid">
            <div class="field">
              <label for="fg-earned">Points earned so far</label>
              <input id="fg-earned" type="number" inputMode="decimal" min="0" step="0.5" ref={earnedField.ref} defaultValue={earnedField.defaultValue} onInput={earnedField.onInput} onBlur={earnedField.onBlur} />
            </div>
            <div class="field">
              <label for="fg-possible">Points possible so far</label>
              <input id="fg-possible" type="number" inputMode="decimal" min="0" step="0.5" ref={possibleField.ref} defaultValue={possibleField.defaultValue} onInput={possibleField.onInput} onBlur={possibleField.onBlur} />
            </div>
            <div class="field">
              <label for="fg-fp">Final worth (points)</label>
              <input id="fg-fp" type="number" inputMode="decimal" min="0" step="0.5" ref={finalPointsField.ref} defaultValue={finalPointsField.defaultValue} onInput={finalPointsField.onInput} onBlur={finalPointsField.onBlur} />
            </div>
            <div class="field">
              <label for="fg-target4">Target grade (%)</label>
              <input id="fg-target4" type="number" inputMode="decimal" min="0" max="200" step="0.1" ref={targetField.ref} defaultValue={targetField.defaultValue} onInput={targetField.onInput} onBlur={targetField.onBlur} />
            </div>
          </div>
          {(() => {
            const tone = feasibility(points.neededPct);
            const shownPoints = Number.isFinite(points.neededPoints) ? Math.max(points.neededPoints, 0) : points.neededPoints;
            const shownPct = Number.isFinite(points.neededPct) ? Math.max(points.neededPct, 0) : points.neededPct;
            return (
              <div class="result" data-tone={tone} role="status" aria-live="polite">
                <p class="result__label">
                  <span class="badge" data-tone={tone}>
                    {FEASIBILITY_LABEL[tone]}
                  </span>
                </p>
                <p class="result__value">
                  {Number.isFinite(shownPoints) ? `${fmt(shownPoints, 1)} pts` : '—'}{' '}
                  {Number.isFinite(shownPct) && <span style="font-size:1.25rem;color:var(--fg-muted)">({fmt(shownPct)}%)</span>}
                </p>
                <p class="result__verdict">
                  {state.finalPoints <= 0
                    ? `The final is worth 0 points, so it can't change your grade. You currently have ${fmt(points.currentPct)}%.`
                    : `You currently have ${fmt(points.currentPct)}%. You need ${fmt(shownPoints, 1)} of ${fmt(state.finalPoints, 1)} points (${fmt(shownPct)}%) on the final to reach ${fmt(state.target)}%.`}
                </p>
              </div>
            );
          })()}
        </section>
      )}

      <div class="tool__actions">
        <button type="button" class="btn" onClick={share}>
          Share this result
        </button>
        <span class="status-msg" role="status" aria-live="polite">
          {status}
        </span>
      </div>
    </div>
  );
}
