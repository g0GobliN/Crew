import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { cardPageOpen, subscribeCardPage } from '../card-open'
import type { CrewApi } from '../api'
import { injectCss } from '../css'
import { useBoard } from '../data'
import type { CardJson, GraphNode } from '../graph-types'
import baseCss from '../styles/base.css'
import flowCss from '../styles/graph.css'
import type { Tile } from '../types'
import { roleIcon } from '../card-format'
import { shortId } from './boardUtil'
import { COLOUR, GLYPH } from './Graph'

// The Desktop flow pane: the card page's flow graph, simplified to a narrow vertical chart of the card that runs now.
// Owner brief -> coordinator -> each run -> verifier -> close, top to bottom, joined by straight lines; parallel and child
// runs stack in order. Each node is the card page's own node box (.node/.card/.hdr/.foot): status glyph, one short label, status chip, role. The running node breathes (the card page's border animation) and the line into it carries the moving dashes and dot. No pan, zoom or minimap.
// A click anywhere on the chart opens that card's full page. The data is the card JSON the card page already fetches
// (GET /card/<id>.json); the session nodes (a run's transcript) are left out. The idea of a flow-graph pane and its card
// selector come from PR #14 by @phuongvm.
export interface FlowPaneProps {
  api: CrewApi
  // opens a Crew route (cardLink(id) or CREW_ROUTE) through the host router; absent on a shell without one
  navigate?: (path: string) => void
  cardLink: (id: string) => string
  boardLink: string
}

// The card's JSON, polled; the pane keeps its own small poll.
function useLiveCard(api: CrewApi, id: string | null, intervalMs = 2000) {
  const [card, setCard] = useState<CardJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setCard(null)
    setError(null)
    if (!id) return
    let live = true
    const load = () =>
      api
        .get<CardJson>('/card/' + id + '.json')
        .then(c => { if (live) { setCard(c); setError(null) } })
        .catch(e => { if (live) setError(String((e && e.message) || e)) })
    load()
    const timer = setInterval(load, intervalMs)
    return () => { live = false; clearInterval(timer) }
  }, [api, id, intervalMs])
  return { card, error }
}

const KIND_LABEL: Record<string, string> = { brief: 'Owner brief', close: 'Close', verifier: 'Verifier' }

// The graph's nodes as a top-to-bottom list: layer, then position in the row. Sessions are a run's detail, not a step.
export function flowSteps(card: CardJson): { id: string; role: string; label: string; status: string; color: string }[] {
  return card.nodes
    .filter((n: GraphNode) => n.kind !== 'session' && n.kind !== 'subagent')
    .sort((a, b) => a.layer - b.layer || (a.x ?? 0) - (b.x ?? 0))
    .map(n => ({
      id: n.id,
      role: n.kind === 'brief' ? 'owner' : n.role || n.kind,
      label: KIND_LABEL[n.kind] ?? (n.kind === 'run' ? 'Run ' + n.label : n.title || 'Coordinator'),
      status: n.status,
      color: n.role_color || 'var(--crew-tone-neutral)'
    }))
}

// One straight connector with an arrowhead, in the card page's edge classes: grey, or green with the dashes and the
// travelling dot (.edge.flow / .edge-dot, the same keyframes) while the node it points at runs.
function Link({ live, arrow, arrowLive }: { live: boolean; arrow: string; arrowLive: string }) {
  return (
    <svg className="fline" viewBox="0 0 20 18" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M10 0 L10 17" className={'edge' + (live ? ' live' : '')} markerEnd={'url(#' + (live ? arrowLive : arrow) + ')'} />
      {live ? (
        <>
          <path d="M10 0 L10 17" className="edge flow" />
          <circle r="2.2" className="edge-dot">
            <animateMotion dur="1.6s" repeatCount="indefinite" path="M10 0 L10 17" fill="freeze" />
          </circle>
        </>
      ) : null}
    </svg>
  )
}

function Chart({ card, go }: { card: CardJson; go: () => void }) {
  const steps = flowSteps(card)
  const uid = useId().replace(/:/g, '')
  const arrow = 'farrow' + uid, arrowLive = 'farrowlive' + uid
  return (
    <div className="crew-graph fchart" role="button" tabIndex={0} title="Open the full flow" onClick={go}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          {[[arrow, 'ah'], [arrowLive, 'ah live']].map(([id, cls]) => (
            <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={cls} />
            </marker>
          ))}
        </defs>
      </svg>
      {steps.map((s, i) => {
        const col = COLOUR[s.status] || 'var(--crew-tone-neutral)'
        return (
          <div key={s.id} className="fstepwrap">
            {i ? <Link live={s.status === 'running'} arrow={arrow} arrowLive={arrowLive} /> : null}
            <div className={'node fnode st-' + s.status + (s.status === 'running' ? ' alive on' : '')} data-id={s.id}>
              <div className="card" style={{ borderLeftColor: s.color }}>
                <div className="hdr">
                  <span className="glyph" style={{ color: col }}>{GLYPH[s.status] || '○'}</span>
                  <span className="name">{s.label}</span>
                </div>
                <div className="foot">
                  <span className="sw chip-tone fstatus" style={{ ['--tone' as string]: col }}>{s.status}</span>
                  <span className="tok frole">{roleIcon(s.role)} {s.role}</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function FlowPane({ api, navigate, cardLink, boardLink }: FlowPaneProps) {
  injectCss('base', baseCss)
  injectCss('graph', flowCss)
  const { board, error: boardError } = useBoard(api)
  // running cards first, then the Needs-you ones
  const cards: Tile[] = []
  const seen = new Set<string>()
  for (const want of [false, true])
    for (const lane of board?.lanes ?? [])
      for (const t of lane.tiles) {
        const needs = lane.key === 'blocked' && t.status === 'blocked'
        if (needs === want && (needs || t.active) && !seen.has(t.id)) { seen.add(t.id); cards.push(t) }
      }
  const [pick, setPick] = useState<string | null>(null)
  // the choice is kept only while that card is listed; after that the pane falls back to the first one
  const picked = pick ? cards.find(t => t.id === pick) : undefined
  useEffect(() => { if (pick && !picked) setPick(null) }, [pick, picked])
  const cur = picked ?? cards[0] ?? null
  const onCardPage = useSyncExternalStore(subscribeCardPage, cardPageOpen, cardPageOpen)
  const { card, error } = useLiveCard(api, cur && !onCardPage ? cur.id : null)
  // The card page already draws the full flow: no chart (and no polling) here, one quiet line until the owner leaves it.
  if (onCardPage)
    return (
      <div className="crew-scope crew-flow">
        <div className="fhint fcompact">Full flow is open on the left - <kbd>Ctrl+J</kbd> hides this pane</div>
      </div>
    )
  return (
    <div className="crew-scope crew-flow">
      <div className="fhint"><kbd>Ctrl+J</kbd> hides this pane</div>
      {cur ? (
        <>
          <div className="fhead">
            {cards.length > 1 ? (
              <select className="fsel" aria-label="Card" value={cur.id} onChange={e => setPick(e.target.value)}>
                {cards.map(t => <option key={t.id} value={t.id}>{shortId(t.id) + '  ' + t.title}</option>)}
              </select>
            ) : (
              <>
                <span className="fid">{shortId(cur.id)}</span>
                <span className="ftitle">{cur.title}</span>
              </>
            )}
          </div>
          {card && card.card_id === cur.id ? (
            <Chart card={card} go={() => navigate?.(cardLink(cur.id))} />
          ) : (
            <div className="fnone">{error ? 'Crew could not load the flow: ' + error : 'Loading the flow...'}</div>
          )}
        </>
      ) : (
        <div className="fnone">
          {boardError && !board ? 'Crew could not load: ' + boardError : 'Nothing running'}
          {' '}<a href="#" className="fboard" onClick={e => { e.preventDefault(); navigate?.(boardLink) }}>Open the board</a>
        </div>
      )}
    </div>
  )
}
