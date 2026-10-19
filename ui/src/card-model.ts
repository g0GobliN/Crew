// What the step panel says about a node, ported from card.js (unitOf, panelKind, panelModel, getSelectedNode).
// Pure functions of the card JSON: the components only draw what these return.
import { cap1, dayTime, fmtAgo, fmtTokens, hhmm } from './card-format'
import type { CardJson, CardNode, CardRole, RouteRow } from './card-types'

export const TAB_SETS: Record<string, string[]> = {
  step: ['Transcript', 'Calls', 'Details'],
  card: ['Contract', 'Route', 'Details'],
  verifier: ['Proof', 'Runs', 'Details'],
  close: ['Result', 'Details'],
  brief: []
}
export const LATEST_N = 6

export const roleDef = (card: CardJson, name: string | undefined): CardRole | null =>
  (card.roles || []).find(r => r.name === name) || null
export const nodeById = (card: CardJson, id: string): CardNode | null =>
  (card.nodes || []).find(n => n.id === id) || null
export const roleColor = (card: CardJson, n: CardNode) =>
  n.role_color || roleDef(card, n.role)?.color || 'var(--crew-tone-neutral)'

export interface Unit { run: CardNode | null; session: CardNode | null; main: CardNode; key: string }
// The unit a node belongs to: {run, session, main} - a run and the session it ran, whichever was clicked.
export function unitOf(card: CardJson, n: CardNode | null): Unit | null {
  if (!n) return null
  let run: CardNode | null = null, sess: CardNode | null = null
  if (n.kind === 'run') {
    run = n
    const rid = (n.evidence || {}).run_id
    for (const x of card.nodes || []) if (x.kind === 'session' && x.run_id !== undefined && x.run_id !== null && x.run_id === rid) sess = x
  } else if (n.kind === 'session') {
    sess = n
    if (n.run_id !== undefined && n.run_id !== null) run = nodeById(card, 'run:' + n.run_id)
  }
  return { run, session: sess, main: n, key: run ? run.id : n.id }
}
export function unitIds(card: CardJson, id: string | null): Record<string, 1> {
  const u = id ? unitOf(card, nodeById(card, id)) : null
  if (!u || !id) return {}
  const out: Record<string, 1> = { [id]: 1 }
  if (u.run) out[u.run.id] = 1
  if (u.session) out[u.session.id] = 1
  return out
}
export function panelKind(n: CardNode): string {
  if (n.kind === 'run' || n.kind === 'session' || n.kind === 'subagent') return 'step'
  if (n.kind === 'card' || n.kind === 'verifier' || n.kind === 'close' || n.kind === 'brief') return n.kind
  return 'step'
}
// The node the scrubber and the panel show: the selected one, else the node with the newest step, else the first.
export function getSelectedNode(card: CardJson, selected: string | null): CardNode | null {
  if (selected) {
    const n = nodeById(card, selected)
    if (n) return n
  }
  let best: CardNode | null = null, bestTs = -1
  for (const n of card.nodes || []) for (const s of n.steps || []) {
    const t = s.ts || 0
    if (t > bestTs) { bestTs = t; best = n }
  }
  return best || (card.nodes && card.nodes[0]) || null
}
// The model pick behind a run: the newest route/reroute row written before it started.
export function modelPick(card: CardJson, startedAt?: number | null): RouteRow | null {
  let pick: RouteRow | null = null
  for (const r of card.route || []) if (r.kind !== 'quota_wall' && (!startedAt || (r.ts || 0) <= startedAt + 5)) pick = r
  return pick
}

export type Chip = [key: string, label: string, value: string | undefined, copyId: string]
export type Kpi = { value: string; label: string; failed?: number }
export interface PanelModel {
  kind: string
  tabs: string[]
  role?: string
  title?: string
  sub?: string
  pill?: [text: string, word: string]
  chips?: Chip[]
  callout?: [title: string, body: string, meta: string, word: string, copyId: string]
  kpis: (Kpi | null)[]
  unit?: Unit | null
  src?: CardNode
  run?: CardNode | null
  sess?: CardNode | null
  live?: boolean
  failed?: number
  calls?: number
}

export function panelModel(card: CardJson, n: CardNode): PanelModel {
  const ev = n.evidence || {}, kind = panelKind(n), u = unitOf(card, n)
  const m: PanelModel = { kind, tabs: TAB_SETS[kind], kpis: [] }
  const other = n.card && n.card !== card.card_id ? n.card : null
  if (kind === 'step' && u) {
    const run = u.run, sess = u.session || (n.kind === 'subagent' ? n : null)
    const re = (run || ({} as CardNode)).evidence || {}, se = (sess || ({} as CardNode)).evidence || {}
    const lv = (sess || run || n).live || {}
    const live = lv.state === 'pending' || (run || n).status === 'running'
    m.role = n.role
    m.unit = u
    m.title = cap1(n.role) + ' · ' + (run ? 'run ' + (re.run_id !== undefined ? re.run_id : run.label) : n.kind === 'subagent' ? 'subagent' : 'session')
    m.sub = live
      ? 'running ' + fmtAgo((run || n).t0 || 0).replace(/ ago$/, '') + (lv.tool ? ' · ' + lv.tool : '')
      : (re.profile || se.profile_name || '') + (re.ended_at || (sess || ({} as CardNode)).t1 ? ' · ended ' + hhmm(re.ended_at || sess!.t1) : '')
    if (other) m.sub += ' · card ' + other
    const outcome = re.outcome || (sess || n).status
    m.pill = [live ? 'Running' : cap1(String(outcome || '').replace(/_/g, ' ')), live ? 'running' : outcome]
    m.chips = [
      ['model', 'model', se.model || ev.model, 'panelModCopy'],
      ['session_id', 'session', se.session_id || ev.session_id, 'panelSidCopy'],
      ['kanban id', 'card', other || card.card_id, 'panelCidCopy']
    ]
    if (run && !live && outcome && outcome !== 'completed' && (re.summary || re.error))
      m.callout = ['Why this run stopped', re.summary || re.error, re.summary && re.error ? re.error : '', outcome, 'panelWhyCopy']
    const tin = +se.input_tokens || 0, tout = +se.output_tokens || 0
    const calls = +(se.tool_call_count || (sess || n).tool_count || 0) || 0
    const failed = +((se.calls_failed !== undefined && se.calls_failed !== null) ? se.calls_failed
      : (sess || n).steps ? (sess || n).steps!.filter(s => s.state === 'err').length : 0) || 0
    m.kpis = [
      { value: re.duration || se.duration || '-', label: 'duration' },
      sess ? { value: fmtTokens(tin + tout), label: 'tokens · ' + fmtTokens(tout) + ' out' } : null,
      sess ? { value: String(calls), label: 'tool calls', failed } : null
    ]
    m.src = sess || run || n
    m.run = run
    m.sess = sess
    m.live = live
    m.failed = failed
    m.calls = calls
  } else if (kind === 'card') {
    m.role = 'coordinator'
    m.title = 'Coordinator · card'
    m.sub = (card.card_title || '') + (ev.run_count ? ' · ' + ev.run_count + ' run' + (ev.run_count === 1 ? '' : 's') : '')
    m.pill = [cap1(card.card_status || n.status), card.card_status || n.status]
    m.chips = [
      ['model', 'model', ev.model_override ? (ev.provider_override ? ev.provider_override + '/' : '') + ev.model_override : '', 'panelModCopy'],
      ['session_id', 'session', ev.coordinator || '', 'panelSidCopy'],
      ['kanban id', 'card', card.card_id, 'panelCidCopy']
    ]
  } else if (kind === 'verifier') {
    m.role = 'verifier'
    m.title = 'Verifier · verdict'
    const runsV = ev.review_runs || [], lastRun = runsV[runsV.length - 1] || {}
    m.sub = ev.by ? 'by ' + ev.by + (ev.ts ? ' · ' + hhmm(ev.ts) : '') : runsV.length ? runsV.length + ' review run(s)' : 'no verdict yet'
    m.pill = [ev.verdict || 'unverified', ev.verdict || 'unverified']
    m.chips = [
      ['model', 'model', '', 'panelModCopy'],
      ['session_id', 'session', lastRun.session_id || '', 'panelSidCopy'],
      ['kanban id', 'card', card.card_id, 'panelCidCopy']
    ]
    if (ev.verdict === 'FAIL')
      m.callout = ['Verification failed', ev.output_head || '(no output recorded)', ev.command ? 'command: ' + ev.command : '', 'FAIL', 'panelWhyCopy']
    m.kpis = [
      { value: ev.rc === null || ev.rc === undefined ? '-' : String(ev.rc), label: 'rc' },
      { value: ev.duration_s === null || ev.duration_s === undefined ? '-' : ev.duration_s + 's', label: 'duration' },
      { value: String(ev.verdict_count || 0), label: 'verdict lines' }
    ]
  } else if (kind === 'close') {
    m.role = 'coordinator'
    m.title = 'Coordinator · close'
    m.sub = ev.completed_at ? 'completed ' + dayTime(ev.completed_at) : 'not closed'
    m.pill = [cap1(ev.status || n.status), ev.status || n.status]
    m.chips = [['model', 'model', '', 'panelModCopy'], ['session_id', 'session', '', 'panelSidCopy'], ['kanban id', 'card', card.card_id, 'panelCidCopy']]
  } else if (kind === 'brief') {
    m.role = n.role || 'owner'
    m.title = 'Owner brief'
    m.sub = ev.source ? 'from ' + ev.source : ''
    m.chips = [['kanban id', 'card', card.card_id, 'panelCidCopy']]
  }
  return m
}
