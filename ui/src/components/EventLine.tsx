import type { CSSProperties, ReactNode } from 'react'
import { fmtTime, toneVar } from '../card-format'
import type { CardJson, CardNode } from '../card-types'

const T = ({ children }: { children: ReactNode }) => <span className="t">{children}</span>

// The line at the top: the card's newest event in words (card.js paintEvent), the run counts at its right end.
function Event({ card }: { card: CardJson }) {
  const nodes = card.nodes || []
  let lastRun: CardNode | null = null, lastEnd = -1
  for (const n of nodes) {
    if ((n.kind === 'run' || n.kind === 'verifier') && (n.t1 || 0) > lastEnd) { lastEnd = n.t1 || 0; lastRun = n }
  }
  let root: CardNode | null = null
  for (const n of nodes) if (n.kind === 'card') root = n
  const rootEv = (root && root.evidence) || {}
  if (rootEv.block_reason)
    return (
      <>
        <T>{fmtTime(root!.t1 || 0)}</T><T>coordinator</T>
        <span className="txt">{'card ' + (card.card_status || 'blocked') + ': ' + rootEv.block_reason}</span>
      </>
    )
  let live: CardNode | null = null
  for (const n of nodes) if (n.status === 'live' || n.status === 'running') live = n
  if (live) {
    const ls = live.steps || []
    const s = ls[ls.length - 1]
    return (
      <>
        <T>{fmtTime(s ? s.ts : live.t1)}</T><T>{live.role || ''}</T>
        <span className="txt">{'working now' + (s ? ': ' + s.tool + (s.args ? ' ' + s.args : '') : '')}</span>
      </>
    )
  }
  let best: { tool: string; args?: string; ts?: number } | null = null, bestTs = -1
  if (lastRun) for (const s of lastRun.steps || []) if ((s.ts || 0) >= lastEnd - 2 && (s.ts || 0) > bestTs) { bestTs = s.ts || 0; best = s }
  const st = card.card_status || ''
  const head = <><T>{fmtTime(lastEnd > 0 ? lastEnd : 0)}</T><T>{card.card_role || 'coordinator'}</T></>
  if (best)
    return <>{head}<span className="txt">{(lastRun!.role || '') + ' ' + best.tool + (best.args ? ' ' + best.args : '') + ' - card ' + st}</span></>
  return <>{head}<span className="txt">{'card ' + st + ' - ' + (card.card_title || '')}</span></>
}

// The run counts as a key-number grid at the right end of the line; a count above zero takes its state's tone.
function Kpis({ card }: { card: CardJson }) {
  const s = card.situation || {}, c = s.counts || {}
  const kpi = (v: number | undefined, label: string, word?: string) => (
    <div className="kpi">
      <div className={'kv' + (v && word ? ' on' : '')} style={{ '--tone': toneVar(word || 'pending') } as CSSProperties}>{+(v || 0)}</div>
      <div className="kl">{label}</div>
    </div>
  )
  const title = (+(s.runs || 0)) + ' runs: ' + (+(c.done || 0)) + ' done, ' + (+(c.blocked || 0)) + ' blocked, ' +
    (+(c.failed || 0)) + ' failed, ' + (+(c.running || 0)) + ' running'
  return (
    <div className="sitkpis" title={title}>
      {kpi(s.runs, 'runs')}{kpi(c.done, 'done', 'done')}{kpi(c.blocked, 'blocked', 'blocked')}{kpi(c.failed, 'failed', 'failed')}{kpi(c.running, 'running', 'running')}
    </div>
  )
}

export function EventLine({ card }: { card: CardJson }) {
  return (
    <div id="event">
      {/* the event text keeps the line's left and ellipsizes; the run counts sit at its right end */}
      <span className="evmain"><Event card={card} /></span>
      <Kpis card={card} />
    </div>
  )
}
