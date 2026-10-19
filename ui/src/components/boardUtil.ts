// Small helpers the board shares (ported from board.js and lib.js).

// A duration in seconds as 4s / 4m / 4h / 4d.
export function fmt(s: number | null | undefined): string {
  if (s === null || s === undefined) return ''
  s = Math.max(0, Math.floor(s))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

export const shortId = (id: string): string => String(id).replace(/^t_/, '').slice(0, 6)

export function hhmm(d: Date): string {
  const p = (x: number) => (x < 10 ? '0' : '') + x
  return p(d.getHours()) + ':' + p(d.getMinutes())
}

// Per-viewer board state (open Archived column, "Show older", lane scroll) lives in sessionStorage like before; the
// storage can throw (private window, blocked data), so every access is guarded and the board works without it.
export function store(k: string): string | null
export function store(k: string, v: string | null): void
export function store(k: string, v?: string | null): string | null | void {
  try {
    if (v === undefined) return sessionStorage.getItem('crew.' + k)
    if (v === null) sessionStorage.removeItem('crew.' + k)
    else sessionStorage.setItem('crew.' + k, v)
  } catch {
    return null
  }
}

export const TONE: Record<string, string> = {
  blocked: 'var(--crew-tone-blocked)', triage: 'var(--crew-tone-blocked)', running: 'var(--crew-tone-running)',
  review: 'var(--crew-tone-review)', ready: 'var(--crew-tone-ready)', todo: 'var(--crew-tone-neutral)',
  done: 'var(--crew-tone-done)', queued: 'var(--crew-tone-ready)', other: 'var(--crew-tone-neutral)'
}
export const QUIET_S = 120   // a live run with no heartbeat for this long crawls amber
