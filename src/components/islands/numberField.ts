/**
 * Bridges a native `<input type="number">` to numeric state WITHOUT fighting the user's keystrokes.
 *
 * The classic bug this avoids: binding `value={state.field}` directly makes the input "controlled",
 * so every keystroke re-renders it with `String(parsedNumber)`. Typing a decimal like "0.5" passes
 * through an intermediate state ("0.") that doesn't round-trip through Number() unchanged — the
 * forced re-render silently drops the trailing "." and can reset the caret to the start of the
 * field, so the next digit lands in the wrong place (observed: typing "0.5" produced "0.015" once
 * clamping was layered on top, or "50" once it wasn't — see the audit's P2-1 finding).
 *
 * The fix: keep the input as an *uncontrolled* DOM element (no `value` prop) and only ever push a
 * new string into it imperatively, and only when the element is not the one currently focused —
 * i.e. when the number changed for a reason other than the user's own typing (a share link loaded,
 * a blur-time clamp, a scale switch, "+ Add course", etc.). While the user is actively editing, we
 * leave their keystrokes alone and just forward parsed values upward via `onChange`.
 */
import { useEffect, useRef } from 'preact/hooks';
import { parseNum } from '../../lib/grades';

export function useNumberField<T extends HTMLInputElement = HTMLInputElement>(value: number, onChange: (v: number) => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const str = Number.isFinite(value) ? String(value) : '';
    if (el.value !== str) el.value = str;
  }, [value]);

  const onInput = (e: Event) => {
    const v = parseNum((e.currentTarget as HTMLInputElement).value);
    if (v != null) onChange(v);
  };

  // A cleared/unparseable field never calls `onChange` (there is no valid number to commit), so
  // without this the DOM would stay blank forever while the result and URL kept showing the last
  // good value (N-5, audit 2) — restore the last committed value on blur so the visible field never
  // disagrees with what's actually being computed. A field-specific onBlur (e.g. clamping to a
  // minimum) can still run afterwards; it only ever sees an already-valid string.
  const onBlur = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    if (parseNum(el.value) == null) {
      const str = Number.isFinite(value) ? String(value) : '';
      if (el.value !== str) el.value = str;
    }
  };

  return { ref, defaultValue: Number.isFinite(value) ? value : '', onInput, onBlur };
}
