// Which document keydown events belong to crew's UI. The card page and the board listen on `document`, so under a host
// that shows another surface beside crew (a split route tile next to a chat) they would also see that surface's keys.
// An event is crew's when it is not typing into an editable element (INPUT, TEXTAREA, SELECT, contenteditable such as a
// chat composer) and its target is inside `root`, or is document.body / nothing (focus nowhere: how the keys work today).
const EDITABLE = '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]'

export function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (el as HTMLElement).isContentEditable === true || !!el.closest(EDITABLE)
}

export function isCrewKey(e: KeyboardEvent, root: Element | null): boolean {
  const n = e.target as Node | null
  const t = n && n.nodeType === 1 ? (n as Element) : null
  if (isEditable(t) || isEditable(document.activeElement)) return false
  if (!t || t === document.body || t === document.documentElement) return true
  return !!root && root.contains(t)
}
