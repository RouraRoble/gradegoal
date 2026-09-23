/** Small shared helpers for the interactive islands (debounce + native/clipboard share). */
import { useEffect, useRef, useState } from 'preact/hooks';

/** Runs `fn` `ms` after the last change to `deps`, skipping the very first render. */
export function useDebouncedEffect(fn: () => void, deps: unknown[], ms = 250): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Copies the current page URL and reports status.
 * When `buildQuery` is given (an island's own encoder, e.g. `() => encodeFinal(state)`), the share
 * URL is built from it directly and the address bar is flushed to match immediately — this avoids
 * sharing a stale URL from the debounced `history.replaceState` (which can lag up to 250ms behind
 * the last keystroke). Without it, the current `location.href` is used as-is.
 */
export function useShare(text: string, buildQuery?: () => string) {
  const [status, setStatus] = useState('');
  const share = async () => {
    let url = location.href;
    if (buildQuery) {
      url = `${location.origin}${location.pathname}${buildQuery()}`;
      try {
        history.replaceState(null, '', url);
      } catch {
        /* ignore — sharing still works even if the address bar can't be updated */
      }
    }
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: text, text, url });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus('Link copied');
    } catch {
      setStatus(url);
    }
    setTimeout(() => setStatus(''), 2500);
  };
  return { share, status };
}
