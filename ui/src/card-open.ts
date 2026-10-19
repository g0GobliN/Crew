// Whether the Crew card page (the full flow chart) is open right now. The page and the right-hand flow pane are two
// separate React roots in Desktop, so they share this tiny module-level flag (one plugin bundle, one module instance).
// Desktop's plugin SDK has no public verb to hide or collapse a pane (only host.paneVisibility to read and host.revealPane
// to show), so the pane does not collapse: while this is true it draws one compact line instead of the chart.
let open = false
const subs = new Set<() => void>()

export function setCardPageOpen(v: boolean): void {
  if (open === v) return
  open = v
  subs.forEach(fn => fn())
}
export const cardPageOpen = (): boolean => open
export function subscribeCardPage(fn: () => void): () => void {
  subs.add(fn)
  return () => { subs.delete(fn) }
}
