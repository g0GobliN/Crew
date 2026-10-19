import { Fragment, useCallback, useId, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKey } from 'react'
import type { CrewApi } from '../api'
import { injectCss } from '../css'
import { CW, type Cam, type CardJson, type GraphNode, type Pos } from '../graph-types'
import baseCss from '../styles/base.css'
import graphCss from '../styles/graph.css'
import { Minimap } from './Minimap'

// Port of scripts/crew_dashboard/card.js: makeNode, stepsFor, drawEdges, drawGraph, applyCam, fitView, centerOn,
// followTarget, bindInput. Python decides the layout (crew_graph.layout_flow sets `layer` and `x` per node); this draws
// the nodes by layer, measures them, and draws the edges between the measured boxes. Same ids and class names as the
// old page, so graph.css (ported from crew.css) applies unchanged.
const GX = 40, GY = 70, PADX = 30, PADY = 18
const CELL_ZOOM = 0.5 // below this zoom a card collapses to a solid status block
const MAX_CHIPS = 4
const MAX_STEP_LINES = 6
export const COLOUR: Record<string, string> = {
  running: 'var(--crew-tone-running)',
  done: 'var(--crew-tone-done)',
  blocked: 'var(--crew-tone-blocked)',
  failed: 'var(--crew-tone-blocked)',
  pending: 'var(--crew-tone-neutral)'
}
const CHIP: Record<string, string> = { pending: 'var(--crew-tone-review)', ok: 'var(--crew-tone-neutral)', err: 'var(--crew-tone-blocked)' }
export const GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', blocked: '✗', pending: '○' }
const ROLE_ICON: Record<string, string> = { coordinator: '◆', worker: '▲', content: '●', verifier: '✓' }
const roleIcon = (name?: string) => (name && ROLE_ICON[name]) || '▪'

export interface GraphProps {
  card: CardJson
  api: CrewApi // kept for the host contract; the graph itself draws from `card` and makes no request
  height?: number
  // The card page can drive these (its panel, its role strip); alone the graph keeps its own selection.
  selectedId?: string | null
  onSelect?: (id: string | null, step?: number) => void
  focusRole?: string | null
  // true when the graph is the whole view (the Desktop flow pane): it then carries its own follow toggle. On the card page
  // the status bar has the follow pill and gets the state through onFollowChange.
  standalone?: boolean
  onFollowChange?: (on: boolean) => void
}

const shortId = (s: string) => (s.length <= 14 ? s : s.slice(0, 7) + '..' + s.slice(-5))
const fmtTokens = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : '' + n)
const pad = (x: number) => (x < 10 ? '0' : '') + x
function fmtTime(sec?: number | null) {
  if (sec == null) return ''
  const d = new Date(sec * 1000)
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}
function nameFor(n: GraphNode) {
  if (n.kind === 'card') return n.title || n.label
  if (n.kind === 'run') return 'run ' + n.label
  if (n.kind === 'verifier' && String(n.label).indexOf('verdict') === 0) return n.label
  if (n.kind === 'brief') return n.title || 'owner brief'
  return n.kind + ' ' + shortId(String(n.label))
}
function descFor(n: GraphNode) {
  const e = n.evidence || {}
  if (n.kind === 'card')
    return 'status ' + (n.status || '-') + ' - coordinator' + (e.writer_role ? ' - ' + e.writer_role + ' did the work' : '') +
      ' - runs ' + (e.run_count || 0) +
      (e.model_override ? '\nworker model: ' + e.model_override + (e.provider_override ? ' via ' + e.provider_override : '') : '')
  if (n.kind === 'run') return (e.profile || '-') + ' - ' + (e.outcome || '-') + ' - ' + (e.duration || '-')
  if (e.verdict) return e.command || ''
  return (e.model || '-') + ' - ' + (e.duration || '-')
}
function toolsLine(n: GraphNode) {
  const c = n.tool_count || 0
  return n.last_tool ? 'tools ' + c + ' - ' + n.last_tool : 'tools ' + c
}
function tokensFor(n: GraphNode) {
  const e = n.evidence || {}
  if (e.verdict) return 'rc=' + e.rc + ' - ' + (e.duration_s != null ? e.duration_s + 's' : '')
  const t = e.output_tokens || 0
  return t ? fmtTokens(t) + ' tok' : ''
}
const stepKey = (s: { tool?: string; ts?: number; args?: string }) => (s.tool || '?') + '@' + (s.ts || 0) + '|' + String(s.args || '').slice(0, 24)

// A run and the session it ran are one unit: selecting either lights both.
function unitIds(nodes: GraphNode[], id: string | null): Record<string, 1> {
  const n = nodes.find(x => x.id === id)
  if (!n) return {}
  const out: Record<string, 1> = { [n.id]: 1 }
  const same = (a: unknown, b: unknown) => a !== undefined && a !== null && a === b
  if (n.kind === 'run') {
    const rid = (n.evidence || {}).run_id
    for (const x of nodes) if (x.kind === 'session' && same(x.run_id, rid)) out[x.id] = 1
  } else if (n.kind === 'session') {
    const rid = n.run_id
    for (const x of nodes) if (x.kind === 'run' && same((x.evidence || {}).run_id, rid)) out[x.id] = 1
  }
  return out
}

// A call still in flight ticks a stopwatch beside its chip, like a live terminal counter.
function Tk({ ts }: { ts: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 500)
    return () => clearInterval(t)
  }, [])
  const el = now - ts
  if (el < 0 || el > 300) return null // a stale line is not a running call
  return <span className="tk">{' ' + el.toFixed(1) + 's'}</span>
}

// The step lines under a card are a terminal window of the last MAX_STEP_LINES steps; a line that arrives after the
// first draw slides in (class "new"). The old page also slid the oldest line out; here it just leaves.
function Steps({ n, col, onPick }: { n: GraphNode; col: string; onPick: (i: number) => void }) {
  const seen = useRef<Set<string> | null>(null)
  const all = n.steps || []
  const keys = new Set<string>()
  const lines = all.slice(-MAX_STEP_LINES).filter(s => !keys.has(stepKey(s)) && !!keys.add(stepKey(s)))
  const marks = useRef<Set<string>>(new Set())
  const [, redraw] = useState(0)
  const before = seen.current
  // a line that was not there on the previous draw keeps its "new" mark for 420 ms (the old card.js timing), then a
  // timer clears it; clearing in the same task would drop the class before the slide-in ever played.
  const added = before ? lines.map(stepKey).filter(k => !before.has(k)) : []
  added.forEach(k => marks.current.add(k))
  useEffect(() => {
    seen.current = new Set(keys)
    if (!added.length) return
    setTimeout(() => { added.forEach(k => marks.current.delete(k)); redraw(x => x + 1) }, 420)
  })
  return (
    <div className="steps">
      {lines.map(s => {
        const k = stepKey(s)
        return (
          <div
            key={k}
            data-k={k}
            className={'step' + (marks.current.has(k) ? ' new' : '')}
            onClick={ev => { ev.stopPropagation(); const i = all.findIndex(x => stepKey(x) === k); if (i >= 0) onPick(i) }}
          >
            <span className="ic">{'▸'}</span>
            <span className="tn" style={{ color: col }}>{s.tool}</span>
            <span className="off">{s.sec != null ? 't+' + s.sec + 's' : ''}</span>
            {s.args ? <span className="args">{s.args}</span> : null}
          </div>
        )
      })}
    </div>
  )
}

interface NodeProps {
  n: GraphNode
  pageCard: string
  rc: string
  pos?: Pos
  sel: boolean
  dim: boolean
  cells: boolean
  nodeRef: (el: HTMLDivElement | null) => void
  cardRef: (el: HTMLDivElement | null) => void
  onSelect: (id: string, step?: number) => void
}
function NodeView({ n, pageCard, rc, pos, sel, dim, cells, nodeRef, cardRef, onSelect }: NodeProps) {
  const col = COLOUR[n.status] || 'var(--crew-tone-neutral)'
  const runs = n.tool_runs || []
  const total = n.tool_run_total || runs.length
  const shown = runs.slice(-MAX_CHIPS)
  const live = n.status === 'running' || n.status === 'pending' || n.t1 == null
  const d = n.kind === 'brief' ? '' : descFor(n)
  return (
    <div
      ref={nodeRef}
      className={'node' + (n.status === 'running' ? ' alive' : '') + (sel ? ' sel' : '') + (dim ? ' dim' : '') + (n.kind === 'brief' ? ' briefcard' : '')}
      data-id={n.id}
      style={pos ? { left: pos.x + 'px', top: pos.y + 'px' } : undefined}
    >
      <div
        ref={cardRef}
        className="card"
        style={{ borderLeftColor: rc, background: cells ? col : undefined }}
        onClick={ev => { ev.stopPropagation(); onSelect(n.id) }}
      >
        <span className="badge" style={{ background: rc }}>{roleIcon(n.role) + ' ' + (n.role || '?')}</span>
        <div className="gold">{n.layer + ' - ' + n.kind + (n.card && n.card !== pageCard ? ' - card ' + n.card : '')}</div>
        <div className="hdr">
          <span className="glyph" style={{ color: col }}>{GLYPH[n.status] || '○'}</span>
          <span className="name">{nameFor(n)}</span>
        </div>
        {n.kind === 'brief' ? (
          <>
            <div className="brieftext">
              {((n.brief && n.brief.text) || '').split(/\n+/).slice(0, 4).map((ln, i) => <div className="bline" key={i}>{ln}</div>)}
            </div>
            <div className="bsrc">{'source: ' + ((n.brief && n.brief.source) || 'owner')}</div>
          </>
        ) : d ? (
          <div className="desc">{d}</div>
        ) : null}
        {n.kind !== 'card' && n.kind !== 'run' ? <div className="tools">{toolsLine(n)}</div> : null}
        <div className="foot">
          <span className="sw chip-tone" style={{ ['--tone' as string]: col }}>{n.status}</span>
          <span className="tok">{tokensFor(n)}</span>
        </div>
        <div className="cellmark">{(n.role || '?').charAt(0).toUpperCase()}</div>
      </div>
      {runs.length ? (
        <div className="chips">
          {total > shown.length ? <span className="chip more">{'+' + (total - shown.length) + ' more'}</span> : null}
          {shown.map((r, ri) => {
            const cc = CHIP[r.state] || 'var(--crew-tone-neutral)'
            const mark = r.state === 'ok' ? ' ✓' : r.state === 'err' ? ' ✗' : ''
            return (
              <span
                key={ri + r.tool}
                className={'chip' + (r.state === 'pending' ? '' : ' done')}
                style={{ color: cc, borderColor: cc }}
                title={r.state + (r.last_ts ? ' - ' + fmtTime(r.last_ts) : '')}
              >
                {r.tool + ((r.count || 0) > 1 ? ' x' + r.count : '') + mark}
                {live && ri === shown.length - 1 && r.last_ts ? <Tk ts={r.last_ts} /> : null}
              </span>
            )
          })}
        </div>
      ) : null}
      <Steps n={n} col={col} onPick={i => onSelect(n.id, i)} />
    </div>
  )
}

const sameLayout = (a: Layout | null, b: Layout) =>
  !!a && a.world.w === b.world.w && a.world.h === b.world.h &&
  Object.keys(b.pos).length === Object.keys(a.pos).length &&
  Object.keys(b.pos).every(k => a.pos[k] && a.pos[k].x === b.pos[k].x && a.pos[k].y === b.pos[k].y && a.pos[k].cardH === b.pos[k].cardH)
interface Layout { pos: Record<string, Pos>; world: { w: number; h: number } }

export function Graph({ card, height, selectedId, onSelect, focusRole: focusProp, standalone, onFollowChange }: GraphProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const arrowId = 'arrow' + uid, arrowLiveId = 'arrowlive' + uid
  injectCss('base', baseCss)
  injectCss('graph', graphCss)
  const nodes = useMemo(() => card.nodes || [], [card.nodes])
  const edges = useMemo(() => card.edges || [], [card.edges])
  const focusRole = focusProp ?? null

  const [innerSel, setInnerSel] = useState<string | null>(null)
  const sel = selectedId !== undefined ? selectedId : innerSel
  const select = useCallback((id: string | null, step?: number) => {
    setInnerSel(id)
    if (onSelect) onSelect(id, step)
  }, [onSelect])

  const [layout, setLayout] = useState<Layout | null>(null)
  const [cam, setCam] = useState<Cam>({ k: 1, tx: 0, ty: 0 })
  const [follow, setFollow] = useState(false)
  const [drag, setDrag] = useState(false)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({})
  const cardEls = useRef<Record<string, HTMLDivElement | null>>({})
  const stageEl = useRef<HTMLDivElement>(null)
  const camRef = useRef(cam); camRef.current = cam
  const layoutRef = useRef(layout); layoutRef.current = layout
  const followRef = useRef(follow); followRef.current = follow
  useEffect(() => { if (onFollowChange) onFollowChange(follow) }, [follow]) // eslint-disable-line react-hooks/exhaustive-deps
  const fitted = useRef(false)
  const fitLayout = useRef<Layout | null>(null) // the layout the automatic view last fitted
  const userCam = useRef(false) // the owner moved the view; until then the view is automatic
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const prevStageW = useRef<number | null>(null)

  const world = layout ? layout.world : { w: 400, h: 300 }
  const roleColor = useCallback((n: GraphNode) => {
    const r = (card.roles || []).find(x => x.name === n.role)
    return n.role_color || (r && r.color) || 'var(--crew-tone-neutral)'
  }, [card.roles])

  const stageSize = () => { const s = stageEl.current; return { w: s ? s.clientWidth : 0, h: s ? s.clientHeight : 0 } }
  const fitView = useCallback(() => {
    const w = layoutRef.current ? layoutRef.current.world : { w: 400, h: 300 }
    const s = stageSize()
    const k = Math.max(0.12, Math.min(Math.min(s.w / w.w, s.h / w.h) * 0.92, 1.2))
    setCam({ k, tx: (s.w - w.w * k) / 2, ty: Math.max(10, (s.h - w.h * k) / 2) })
  }, [])
  const centerOn = useCallback((id: string) => {
    const it = layoutRef.current && layoutRef.current.pos[id]
    if (!it) return
    const s = stageSize(), k = camRef.current.k
    setCam({ k, tx: s.w / 2 - (it.x + CW / 2) * k, ty: s.h / 2 - (it.y + it.cardH / 2) * k })
  }, [])
  const followTarget = () => {
    let best: GraphNode | null = null, bt = -1
    let pool = nodes.filter(n => n.status === 'running')
    if (!pool.length) pool = nodes
    for (const n of pool) { const t = n.last_ts || 0; if (t >= bt) { bt = t; best = n } }
    return best
  }
  const stopFollow = () => { if (followRef.current) setFollow(false) }

  // A different card (the pane following the live card) starts over: fit, no selection.
  const cardId = card.card_id
  useLayoutEffect(() => { fitted.current = false; userCam.current = false; setInnerSel(null) }, [cardId])

  // drawGraph: nodes are placed by layer, left to right in the order Python gave (`x`); a row is as tall as its tallest node.
  useLayoutEffect(() => {
    const layers: Record<number, GraphNode[]> = {}
    let maxLayer = 0
    for (const n of nodes) { (layers[n.layer] = layers[n.layer] || []).push(n); if (n.layer > maxLayer) maxLayer = n.layer }
    const pos: Record<string, Pos> = {}
    let y = PADY, totalW = PADX
    for (let l = 0; l <= maxLayer; l++) {
      const lyr = (layers[l] || []).slice().sort((a, b) => (a.x || 0) - (b.x || 0))
      if (!lyr.length) continue
      let x = PADX, maxH = 0
      for (const n of lyr) {
        const el = nodeEls.current[n.id], ce = cardEls.current[n.id]
        pos[n.id] = { x, y, cardH: (ce && ce.offsetHeight) || 40 }
        maxH = Math.max(maxH, (el && el.offsetHeight) || 0)
        x += CW + GX
      }
      totalW = Math.max(totalW, x - GX + PADX)
      y += maxH + GY
    }
    const next: Layout = { pos, world: { w: Math.max(totalW, 300), h: Math.max(y - GY + PADY, 200) } }
    setLayout(prev => (sameLayout(prev, next) ? prev : next))
  }, [nodes])

  // After a layout: fit once, and keep the camera on the follow target when following.
  useEffect(() => {
    if (!layout) return
    if (!fitted.current) { fitted.current = true; fitLayout.current = layout; fitView() }
    // the first layout can be measured before the nodes have their final height (the pane, whose CSS lands with it):
    // while the owner has not moved the view, a changed layout re-fits, so the view never stays at a stale zoom
    else if (layout !== fitLayout.current && !userCam.current) { fitLayout.current = layout; fitView() }
    if (followRef.current) { const t = followTarget(); if (t) centerOn(t.id) }
  }, [layout, follow, nodes])

  // The stage changes size when a docked panel opens or the pane is resized. Until the owner has moved the view it
  // re-fits; after, it keeps the zoom and shifts by half the width gained or lost so the point they watch stays put.
  useEffect(() => {
    const el = stageEl.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const s = stageSize()
      setStage(p => (p.w === s.w && p.h === s.h ? p : s))
      const prev = prevStageW.current
      prevStageW.current = s.w
      if (!layoutRef.current) return
      if (userCam.current && prev !== null) { const d = (s.w - prev) / 2; if (d) setCam(c => ({ ...c, tx: c.tx + d })) }
      else if (!userCam.current) fitView()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitView])

  // input: wheel zooms about the pointer, a press on the canvas pans, a click on empty canvas clears the selection
  useEffect(() => {
    const st = stageEl.current
    if (!st) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = st.getBoundingClientRect(), c = camRef.current
      const mx = e.clientX - r.left, my = e.clientY - r.top
      const k2 = Math.max(0.12, Math.min(2.5, c.k * Math.exp(-e.deltaY * 0.0015)))
      const wx = (mx - c.tx) / c.k, wy = (my - c.ty) / c.k
      userCam.current = true
      stopFollow()
      setCam({ k: k2, tx: mx - wx * k2, ty: my - wy * k2 })
    }
    st.addEventListener('wheel', wheel, { passive: false }) // React's onWheel is passive and cannot stop the page scrolling
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.x, dy = e.clientY - d.y
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; setDrag(true); stopFollow() }
      if (d.moved) { userCam.current = true; setCam({ k: camRef.current.k, tx: d.tx + dx, ty: d.ty + dy }) }
    }
    const up = () => {
      const d = dragRef.current
      if (d && d.moved) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
      dragRef.current = null
      setDrag(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      st.removeEventListener('wheel', wheel)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const onSelectNode = (id: string, step?: number) => { if (!suppressClick.current) select(id, step) }
  const units = unitIds(nodes, sel)
  const cells = cam.k < CELL_ZOOM
  const g = 24 * cam.k
  const byId: Record<string, { n: GraphNode; p: Pos }> = {}
  if (layout) for (const n of nodes) if (layout.pos[n.id]) byId[n.id] = { n, p: layout.pos[n.id] }

  const key = (e: ReactKey) => {
    if (e.key === 'f') { stopFollow(); userCam.current = false; fitView() }
    else if (e.key === 'F') setFollow(f => !f)
    else if (e.key === '0') { stopFollow(); userCam.current = true; setCam({ k: 1, tx: 0, ty: 0 }) }
    else if (e.key === 'Escape') select(null)
  }

  return (
    <div className="crew-scope crew-graph" style={height ? { height: height + 'px' } : undefined} tabIndex={0} onKeyDown={key}>
      <div
        ref={stageEl}
        className={'stage' + (drag ? ' drag' : '')}
        style={{ backgroundSize: g + 'px ' + g + 'px', backgroundPosition: cam.tx + 'px ' + cam.ty + 'px' }}
        onClick={() => { if (!suppressClick.current && sel) select(null) }}
        onMouseDown={e => {
          if (e.button !== 0) return
          e.preventDefault() // a press on the canvas starts a pan, never a text selection across the nodes
          dragRef.current = { x: e.clientX, y: e.clientY, tx: camRef.current.tx, ty: camRef.current.ty, moved: false }
          suppressClick.current = false
        }}
        onDoubleClick={() => { stopFollow(); userCam.current = false; fitView() }}
      >
        <div
          className={'world' + (cells ? ' cells' : '')}
          style={{ transform: 'translate(' + cam.tx + 'px,' + cam.ty + 'px) scale(' + cam.k + ')' }}
        >
          <svg className="edges" width={world.w} height={world.h} style={{ width: world.w + 'px', height: world.h + 'px' }}>
            <defs>
              {[[arrowId, 'ah'], [arrowLiveId, 'ah live']].map(([id, cls]) => (
                <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className={cls} />
                </marker>
              ))}
            </defs>
            {edges.map((e, i) => {
              const a = byId[e.from], b = byId[e.to]
              if (!a || !b) return null
              const x1 = a.p.x + CW / 2, y1 = a.p.y + a.p.cardH, x2 = b.p.x + CW / 2, y2 = b.p.y
              const c = Math.max(y2 - y1, 0) * 0.55
              const d = 'M' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + c) + ', ' + x2 + ' ' + (y2 - c) + ', ' + x2 + ' ' + y2
              // green while the child it points at is running, grey otherwise; a running child gets dots travelling along it
              const live = b.n.status === 'running'
              const off = !!focusRole && a.n.role !== focusRole && b.n.role !== focusRole
              return (
                <Fragment key={e.from + '>' + e.to + i}>
                  <path d={d} className={'edge' + (live ? ' live' : '') + (off ? ' dim' : '')} markerEnd={'url(#' + (live ? arrowLiveId : arrowId) + ')'} />
                  {live && !off ? (
                    <>
                      <path d={d} className="edge flow" />
                      <circle r="2.6" className="edge-dot">
                        <animateMotion dur="1.6s" repeatCount="indefinite" path={d} fill="freeze" />
                      </circle>
                    </>
                  ) : null}
                </Fragment>
              )
            })}
          </svg>
          <div className="nodes" style={{ width: world.w + 'px', height: world.h + 'px' }}>
            {nodes.map(n => (
              <NodeView
                key={n.id}
                n={n}
                pageCard={card.card_id}
                rc={roleColor(n)}
                pos={layout ? layout.pos[n.id] : undefined}
                sel={!!units[n.id]}
                dim={!!focusRole && n.role !== focusRole}
                cells={cells}
                nodeRef={el => { nodeEls.current[n.id] = el }}
                cardRef={el => { cardEls.current[n.id] = el }}
                onSelect={onSelectNode}
              />
            ))}
          </div>
        </div>
        {standalone ? (
          <button type="button" className={'gfollow' + (follow ? ' on' : '')} onClick={e => { e.stopPropagation(); setFollow(f => !f) }}>
            {'follow ' + (follow ? 'on' : 'off')}
          </button>
        ) : null}
        <Minimap
          nodes={nodes}
          pos={layout ? layout.pos : {}}
          world={world}
          cam={cam}
          stage={stage}
          focusRole={focusRole}
          roleColor={roleColor}
          onCenter={(wx, wy) => {
            const s = stageSize()
            userCam.current = true
            stopFollow()
            setCam({ k: camRef.current.k, tx: s.w / 2 - wx * camRef.current.k, ty: s.h / 2 - wy * camRef.current.k })
          }}
        />
        <div className="zoomlbl">{Math.round(cam.k * 100) + '%' + (cells ? ' - cells' : '')}</div>
      </div>
    </div>
  )
}
