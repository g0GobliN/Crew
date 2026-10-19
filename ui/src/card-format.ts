// Formatters and small pure helpers of the card page, ported from scripts/crew_dashboard/card.js (same output).
import type { Step } from './card-types'

export function shortId(s: unknown): string {
  const t = String(s)
  return t.length <= 14 ? t : t.slice(0, 7) + '..' + t.slice(-5)
}
export function fmtTokens(n: unknown): string {
  const v = +(n as number) || 0
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
  return '' + v
}
const pad = (x: number) => (x < 10 ? '0' : '') + x
export function fmtTime(sec: number | null | undefined): string {
  if (sec == null) return ''
  const d = new Date(sec * 1000)
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}
export function fmtAgo(sec: number | null | undefined): string {
  if (!sec) return ''
  let d = Date.now() / 1000 - sec
  if (d < 0) d = 0
  if (d < 60) return Math.round(d) + 's ago'
  if (d < 3600) return Math.round(d / 60) + 'm ago'
  if (d < 86400) return Math.round(d / 3600) + 'h ago'
  return Math.round(d / 86400) + 'd ago'
}
// An AGE in seconds (not a timestamp): "4m 12s ago".
export function fmtAge(sec: unknown): string {
  if (sec === null || sec === undefined || sec === '') return 'age unknown'
  const s = Math.max(0, Math.round(+(sec as number) || 0))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ago'
  return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h ago'
}
export function fmtExact(n: unknown): string {
  return Math.round(+(n as number) || 0).toLocaleString('en-US')
}
export function offLabel(s: { sec?: number | null }): string {
  return s.sec != null ? 't+' + s.sec + 's' : ''
}
export function cap1(s: unknown): string {
  const t = String(s || '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
export function hhmm(ts: number | null | undefined): string {
  return ts ? fmtTime(ts).slice(0, 5) : ''
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dayTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

export const GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', blocked: '✗', pending: '○' }
export const ROLE_ICON: Record<string, string> = { coordinator: '◆', worker: '▲', content: '●', verifier: '✓' }
export const roleIcon = (name: string | undefined) => ROLE_ICON[name || ''] || '▪'
// card.js COLOUR (crew_graph.HTML_COLOURS): a node's status as a tone variable.
export const STATUS_COLOUR: Record<string, string> = {
  running: 'var(--crew-tone-running)',
  done: 'var(--crew-tone-done)',
  blocked: 'var(--crew-tone-blocked)',
  failed: 'var(--crew-tone-blocked)',
  pending: 'var(--crew-tone-neutral)'
}
export const CHIP_COLOUR: Record<string, string> = {
  pending: 'var(--crew-tone-review)',
  ok: 'var(--crew-tone-neutral)',
  err: 'var(--crew-tone-blocked)'
}

const STATUS_TONE: Record<string, string> = {
  running: 'running', live: 'running', pending: 'neutral', done: 'done', completed: 'done', finished: 'done',
  blocked: 'blocked', triage: 'blocked', failed: 'blocked', crashed: 'blocked', timed_out: 'blocked', gave_up: 'blocked',
  review: 'review', review_requested: 'review', ready: 'ready', queued: 'ready', todo: 'neutral', PASS: 'running',
  verified: 'running', FAIL: 'blocked', unverified: 'review', rate_limited: 'review'
}
export const toneVar = (word?: string) => 'var(--crew-tone-' + (STATUS_TONE[word || ''] || 'neutral') + ')'

// The share of the ceiling as a colour sliding green -> yellow -> red (the board card's own budget thresholds).
export function budgetTone(pct: number): string {
  const G = 'var(--crew-tone-running)', Y = 'var(--crew-tone-review)', R = 'var(--crew-tone-blocked)'
  if (pct >= 100) return R
  if (pct >= 80) return 'color-mix(in srgb, ' + R + ' ' + Math.round(((pct - 80) / 20) * 100) + '%, ' + Y + ')'
  if (pct >= 50) return 'color-mix(in srgb, ' + Y + ' ' + Math.round(((pct - 50) / 30) * 100) + '%, ' + G + ')'
  return G
}

// ---- steps
export const stepKey = (s: Step) => (s.tool || '?') + '@' + (s.ts || 0) + '|' + String(s.args || '').slice(0, 24)
const stepWord = (s: { state?: string }) => (s.state === 'err' ? 'failed' : s.state === 'pending' ? 'still running' : 'ok')

export interface StepGroup {
  k: string
  tool: string
  ts?: number
  sec?: number | null
  args: string[]
  states: (string | undefined)[]
  note?: string
  out?: string
  say?: string
  state: string
}
// Parallel calls land in one assistant message: same tool, same second. The panel shows them as one box that lists
// every arg; the box's state is the worst of its calls (a failure is never averaged away).
export function groupParallel(steps: Step[] | undefined): StepGroup[] {
  const out: StepGroup[] = []
  for (const s of steps || []) {
    const k = (s.tool || '?') + '@' + (s.ts || 0)
    const last = out[out.length - 1]
    if (last && last.k === k) {
      last.args.push(s.args || '')
      last.states.push(s.state)
      if (!last.note) last.note = s.note
      if (s.out) last.out = s.out
      if (!last.say) last.say = s.say
    } else {
      out.push({ k, tool: s.tool, ts: s.ts, sec: s.sec, args: [s.args || ''], states: [s.state], note: s.note, out: s.out, say: s.say, state: '' })
    }
  }
  for (const g of out) g.state = g.states.indexOf('err') >= 0 ? 'err' : g.states.indexOf('pending') >= 0 ? 'pending' : 'ok'
  return out
}
// The state line of a step: the word, the failure's reason, the last text the step's own output produced, and when.
// The reason and the output are usually the same text: the longer one is printed once, never both.
export function stepStatus(g: StepGroup): string {
  const note = g.note || '', out = g.out || ''
  let text = ''
  if (note && out) text = out.indexOf(note) === 0 || note.indexOf(out) === 0 ? (out.length > note.length ? out : note) : note + ' - ' + out
  else text = note || out
  const bits = [stepWord(g)]
  if (text) bits.push(text)
  if (g.ts) bits.push(fmtTime(g.ts))
  return bits.join(' - ')
}
export const tickTime = (s: Step) => (s.ts ? fmtTime(s.ts) : offLabel(s))

// The chat a card came from, out of the body's "<profile>/<session id>" coordinator value. null when the profile or
// the id is not a plain token, or when the card never had a session ("<profile>/no-session").
export function coordinatorTarget(value: unknown): { profile: string; session: string } | null {
  const m = /^([^/]*)\/([^/]*)$/.exec(String(value || ''))
  if (!m || m[2] === 'no-session') return null
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(m[1]) || !/^[A-Za-z0-9_-]{1,128}$/.test(m[2])) return null
  return { profile: m[1], session: m[2] }
}

export function copyText(text: string, done: (ok: boolean) => void): void {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(false))
      return
    }
  } catch { /* fall through to the textarea route */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    done(ok)
  } catch { done(false) }
}

// brief block of the rail (crew_graph._brief_fields): the exact words the coordinator was given.
export function briefFields(nodes: { kind: string; brief?: any }[]): { text: string; src: string } | null {
  const b = nodes.find(n => n.kind === 'brief')?.brief || null
  if (!b || !String(b.text || '').trim()) return null
  const src = b.source || 'owner'
  const when = b.ts ? fmtTime(b.ts) : ''
  const label = src === 'owner' ? "the owner's words when /crew was called"
    : src === 'card goal' ? "the card's own GOAL line - no brief was recorded" : 'source: ' + src
  return { text: String(b.text).trim(), src: label + (when ? ' - ' + when : '') }
}
