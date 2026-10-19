import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cap1, copyText, dayTime, fmtTime, fmtTokens, toneVar } from '../card-format'
import { getSelectedNode, modelPick, panelModel, roleDef, type Chip, type PanelModel } from '../card-model'
import type { CardJson, CardNode } from '../card-types'
import { useCardUi } from '../card-ui'
import { useCrewHost } from '../host'
import { callGroups, CallsHead, callRows, Md, transcriptRows, type Row } from './Runs'

const tone = (word?: string) => ({ '--tone': toneVar(word) }) as CSSProperties

function Pill({ text, word }: { text?: string; word?: string }) {
  if (!text) return null
  return <span className="pill" style={tone(word || text)}><i />{text}</span>
}
function Avatar({ card, role }: { card: CardJson; role?: string }) {
  const hue = roleDef(card, role)?.color || 'var(--crew-tone-neutral)'
  return <span className="avatar lg" style={{ '--hue': hue } as CSSProperties}>{cap1(role || '?').slice(0, 1)}</span>
}
function kvRow(key: string, val: ReactNode, sub?: string) {
  if (val === null || val === undefined || val === '' || val === false) return null
  return <div className="kvr" key={key}><dt>{key}</dt><dd>{val}{sub ? <small>{sub}</small> : null}</dd></div>
}
// The leftover scalar evidence in a closed "Raw fields" box; `skip` names the keys the tab already showed.
function rawFields(evs: Record<string, any>[], skip: Record<string, number>) {
  const rows: ReactNode[] = []
  for (const ev of evs) for (const k of Object.keys(ev || {})) {
    const v = ev[k]
    if (skip[k] || v === null || v === undefined || v === '' || typeof v === 'object') continue
    rows.push(kvRow(k, /at$/.test(k) || k === 'ts' ? (typeof v === 'number' ? fmtTime(v) : String(v)) : String(v)))
    skip[k] = 1
  }
  return rows.length ? <details className="raw"><summary>Raw fields</summary><dl>{rows}</dl></details> : null
}
function RoleAbout({ card, role }: { card: CardJson; role?: string }) {
  const rd = roleDef(card, role) || { purpose: '', proof: '' }
  if (!rd.purpose && !rd.proof) return null
  return (
    <div className="sec">
      <div className="label">{'About the ' + role + ' role'}</div>
      <div className="prose">{rd.purpose || ''}</div>
      {rd.proof ? <div className="prose dimp">{'Proof: ' + rd.proof}</div> : null}
    </div>
  )
}
function Route({ card }: { card: CardJson }) {
  const rows = card.route || []
  if (!rows.length) return <div className="empty">No model was routed for this card: its runs used the role profile's own model.</div>
  return (
    <div className="route">
      {rows.map((r, i) => {
        const wall = r.kind === 'quota_wall'
        const what = wall
          ? 'quota wall' + (r.wall_number ? ' #' + r.wall_number : '') + ' on ' + (r.model || '?') + ' - ' + (r.why || '')
          : (r.kind === 'reroute' ? 're-routed to ' : 'picked ') + (r.provider ? r.provider + '/' : '') + (r.model || '?') + (r.why ? ' - ' + r.why : '')
        return <div className="rr" key={i}><time>{dayTime(r.ts)}</time><span className={wall ? 'bad' : ''}>{what}</span></div>
      })}
    </div>
  )
}
function detailsStep(card: CardJson, m: PanelModel) {
  const re = (m.run || ({} as CardNode)).evidence || {}, se = (m.sess || ({} as CardNode)).evidence || {}
  const src = m.src || ({} as CardNode)
  const pick = modelPick(card, re.started_at || src.t0)
  const skip: Record<string, number> = {
    model: 1, session_id: 1, run_id: 1, profile: 1, profile_name: 1, started_at: 1, ended_at: 1, duration: 1, input_tokens: 1,
    output_tokens: 1, message_count: 1, tool_call_count: 1, calls_failed: 1, summary: 1, error: 1, outcome: 1
  }
  return (
    <>
      <dl>
        {kvRow('Model pick', pick ? pick.why || pick.model : '', pick ? 'routed ' + dayTime(pick.ts) + ' · ' + (pick.provider || '') + '/' + (pick.model || '') : '')}
        {kvRow('Profile', re.profile || se.profile_name || '')}
        {kvRow('Started', fmtTime(re.started_at || src.t0), (re.ended_at ? 'ended ' + fmtTime(re.ended_at) : '') + (re.duration ? ' · ' + re.duration : ''))}
        {kvRow('Tokens', m.sess ? fmtTokens(se.input_tokens) + ' in · ' + fmtTokens(se.output_tokens) + ' out' : '', se.message_count ? se.message_count + ' messages' : '')}
        {kvRow('Prompt', src.prompt ? <span className="mono">{src.prompt}</span> : '')}
      </dl>
      <RoleAbout card={card} role={m.role} />
      {rawFields([re, se], skip)}
    </>
  )
}
// The body of the non-list tabs. null = a reconciled list tab (Transcript, Calls).
function tabBody(card: CardJson, n: CardNode, m: PanelModel, tab: string | null): { doc: ReactNode } | null {
  const ev = n.evidence || {}
  if (m.kind === 'card') {
    if (tab === 'Contract')
      return { doc: (
        <dl>
          {kvRow('Done when', ev.done_when ? <Md text={ev.done_when} /> : '')}
          {kvRow('Writer', (ev.writer_role || '') + (ev.assignee ? ' · ' + ev.assignee : ''))}
          {kvRow('Verifier', ev.verifier || '')}
          {kvRow('Model pin', ev.model_override ? (ev.provider_override ? ev.provider_override + '/' : '') + ev.model_override : "none - the role profile's model")}
          {kvRow('Budget', ev.ceiling ? fmtTokens(ev.spent) + ' of ' + fmtTokens(ev.ceiling) + ' tokens' : '')}
          {kvRow('Result', ev.result ? <Md text={ev.result} /> : '')}
        </dl>
      ) }
    if (tab === 'Route') return { doc: <Route card={card} /> }
    const dec = (ev.decisions || []) as { ts?: number; label?: string; decision?: string }[]
    return { doc: (
      <>
        {dec.length ? (
          <div className="sec"><div className="label">Coordinator decisions</div>
            <div className="route">{dec.map((d, i) => <div className="rr" key={i}><time>{dayTime(d.ts)}</time><span>{d.label || d.decision || ''}</span></div>)}</div>
          </div>
        ) : null}
        <RoleAbout card={card} role="coordinator" />
        {rawFields([ev], { done_when: 1, writer_role: 1, assignee: 1, verifier: 1, model_override: 1, provider_override: 1, ceiling: 1, spent: 1, result: 1, block_reason: 1, status: 1, decisions: 1 })}
      </>
    ) }
  }
  if (m.kind === 'verifier') {
    if (tab === 'Proof')
      return { doc: (
        <>
          <dl>
            {kvRow('Done when', ev.done_when ? <Md text={ev.done_when} /> : '')}
            {kvRow('Command', ev.command ? <span className="mono">{ev.command}</span> : '')}
            {kvRow('Verdict', ev.verdict || 'unverified', ev.by ? 'by ' + ev.by + (ev.ts ? ' · ' + dayTime(ev.ts) : '') : '')}
          </dl>
          {ev.output_head ? <div className="sec"><div className="label">Output</div><div className="cmd">{ev.output_head}</div></div> : null}
        </>
      ) }
    if (tab === 'Runs') {
      const rs = (ev.review_runs || []) as any[]
      return { doc: rs.length ? (
        <div className="route">
          {rs.map((r, i) => (
            <div className="rr" key={i}><time>{'run ' + r.run_id}</time>
              <span>{(r.profile || '') + ' · ' + (r.outcome || '-') + ' · ' + (r.duration || '-') + (r.summary ? ' - ' + r.summary : '')}</span></div>
          ))}
        </div>
      ) : <div className="empty">No review run: the proof was run without a verifier session.</div> }
    }
    return { doc: (
      <>
        <RoleAbout card={card} role="verifier" />
        {rawFields([ev], { done_when: 1, command: 1, verdict: 1, by: 1, ts: 1, output_head: 1, rc: 1, duration_s: 1, verdict_count: 1, review_runs: 1 })}
      </>
    ) }
  }
  if (m.kind === 'close') {
    if (tab === 'Result')
      return { doc: (
        <>
          <dl>{kvRow('Status', ev.status || '')}{kvRow('Completed', dayTime(ev.completed_at))}</dl>
          {ev.result ? <div className="prose"><Md text={ev.result} /></div> : <div className="empty">No result recorded yet.</div>}
        </>
      ) }
    return { doc: rawFields([ev], { status: 1, completed_at: 1, result: 1 }) }
  }
  if (m.kind === 'brief')
    return { doc: (
      <>
        <div className="prose"><Md text={ev.text || ev.brief || n.brief || ''} /></div>
        {ev.source || ev.by ? <div className="cm">{[ev.source, ev.by, ev.origin].filter(x => x).join(' · ')}</div> : null}
      </>
    ) }
  if (tab === 'Details') return { doc: detailsStep(card, m) }
  return null
}

function readTab(kind: string): string | null {
  try { return window.localStorage.getItem('crewTab.' + kind) } catch { return null }
}
function storeTab(kind: string, tab: string) {
  try { window.localStorage.setItem('crewTab.' + kind, tab) } catch { /* private mode: the tab just is not remembered */ }
}

export interface PanelProps {
  // #node=<id>&tab=<name> in the address bar (browser only; Desktop owns its own hash).
  hash: boolean
  // a tab asked for by the address bar: applied once to the node it names
  askedTab: { node: string; tab: string } | null
  onTabApplied(): void
}

// The step panel (ui-spec section 5): one template for every node kind - header, id chips, callout, KPIs, tabs, body.
// It is always mounted; every poll patches it in place. The element tree is stable (keys are the data's own keys), so
// React touches only what changed: a reader's scroll offset, an in-progress text selection and the once-only arrival
// animation survive the 2 s poll (owner rules 1-7, crew_panel_steps_proof.py).
export function Panel({ hash, askedTab, onTabApplied }: PanelProps) {
  const ui = useCardUi()
  const { card } = ui
  const { renderMarkdown } = useCrewHost()
  const [tabs, setTabs] = useState<Record<string, string | null>>({})
  const [views, setViews] = useState<Record<string, string>>({})
  const [openCalls, setOpenCalls] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [flash, setFlash] = useState<Record<string, { until: number; label: string }>>({})
  const seen = useRef<Record<string, Set<string>>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const open = ui.panelOpen
  const n = open ? getSelectedNode(card, ui.selected) : null
  const m = n ? panelModel(card, n) : null
  const ukey = n ? (m!.unit && m!.unit.key) || n.id : ''

  // The tab: the address bar's ask (once), else the one remembered per node kind, else the first.
  let tab: string | null = null
  if (m && m.tabs.length) {
    const asked = askedTab && n && askedTab.node === n.id
      ? m.tabs.find(t => t.toLowerCase() === String(askedTab.tab).toLowerCase()) : undefined
    const want = asked || tabs[m.kind] || readTab(m.kind)
    tab = m.tabs.indexOf(want || '') >= 0 ? (want as string) : m.tabs[0]
  }
  useEffect(() => {
    if (m && askedTab && n && askedTab.node === n.id) {
      const t = m.tabs.find(x => x.toLowerCase() === String(askedTab.tab).toLowerCase())
      if (t) { storeTab(m.kind, t); setTabs(s => ({ ...s, [m.kind]: t })) }
      onTabApplied()
    }
  })
  // the scrolling body starts at the top for a new unit or tab, and is otherwise left exactly where the reader put it
  useLayoutEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [ukey, tab, open])
  // the address bar follows the open node and tab
  useEffect(() => {
    if (!hash || typeof window === 'undefined') return
    const parts: string[] = []
    for (const kv of (window.location.hash || '').replace(/^#/, '').split('&')) if (kv && !/^(node|tab)=/.test(kv)) parts.push(kv)
    if (open && n) {
      parts.push('node=' + encodeURIComponent(n.id))
      if (tab) parts.push('tab=' + tab.toLowerCase())
    }
    const h = parts.length ? '#' + parts.join('&') : ''
    if (h !== window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search + h) } catch { /* sandboxed */ }
    }
  }, [hash, open, n && n.id, ukey, tab])
  // arrival animation bookkeeping: what the Transcript already showed
  const rowsT = open && m && tab === 'Transcript' ? transcriptRows(m, expanded, renderMarkdown) : null
  const seenNow = rowsT ? seen.current[ukey] : undefined
  useEffect(() => {
    if (!rowsT) return
    const s = (seen.current[ukey] = seen.current[ukey] || new Set())
    for (const r of rowsT) s.add(r.key)
  })

  if (!open || !n || !m) return <div id="panel" className={open ? 'open' : ''} />

  const copy = (id: string, text: string) => {
    copyText(text, ok => {
      setFlash(f => ({ ...f, [id]: { until: Date.now() + 1600, label: ok ? 'copied' : 'select + copy' } }))
      setTimeout(() => setFlash(f => ({ ...f })), 1700)
    })
  }
  const flashLabel = (id: string, dflt: string) => (flash[id] && flash[id].until > Date.now() ? flash[id].label : dflt)
  const chip = (c: Chip) => {
    const [key, label, value, copyId] = c
    return (
      <button type="button" className="idc" id={copyId} key={copyId} data-k={key} data-v={value || ''} title={'copy ' + key} aria-label={'copy ' + key}
        onClick={e => { e.stopPropagation(); copy(copyId, key + ': ' + (value || '')) }}>
        {label}<b className="idv">{value || 'none'}</b><i>{flash[copyId] && flash[copyId].until > Date.now() ? flash[copyId].label : '⧉'}</i>
      </button>
    )
  }

  let rows: Row[] = []
  let top: ReactNode = null
  let doc: ReactNode = null
  let listCls = 'plist'
  const body = tabBody(card, n, m, tab)
  if (body) doc = body.doc
  else if (tab === 'Transcript') {
    rows = rowsT || []
    listCls = 'plist transcript'
    if (!rows.length) doc = <div className="empty">No text yet, this run has only made tool calls.</div>
  } else {
    const cg = callGroups(m, views)
    top = <CallsHead m={m} cg={cg} onView={v => setViews(s => ({ ...s, [ukey]: v }))} />
    listCls = 'plist calls'
    rows = callRows(m, cg, openCalls)
    if (!cg.steps.length) doc = <div className="empty">No tool call recorded for this run.</div>
    else if (!cg.groups.length) doc = <div className="empty">{cg.view === 'failed' ? 'No failed call.' : 'No call.'}</div>
  }
  const noSel = () => !String(window.getSelection ? window.getSelection() || '' : '')
  const dedup = new Map<string, number>()
  const kpis = m.kpis.filter(k => k)

  return (
    <div id="panel" className="open">
      <div className="phead">
        <div className="pnav">
          {n.kind === 'card' ? <span>Card</span>
            : <button type="button" className="navback" data-node={'card:' + card.card_id} onClick={() => ui.select('card:' + card.card_id)}>{'‹ Card'}</button>}
          <span className="dim">/</span><span>{m.role || n.kind}</span>
          <button type="button" className="x" title="close (esc)" onClick={() => ui.closePanel()}>{'✕'}</button>
        </div>
        <div className="pid">
          <Avatar card={card} role={m.role} />
          <div className="pidt"><div className="pt">{m.title}</div>{m.sub ? <div className="ps">{m.sub}</div> : null}</div>
          {m.pill ? <Pill text={m.pill[0]} word={m.pill[1]} /> : null}
        </div>
        <div className="ids">{(m.chips || []).map(chip)}</div>
        <div className="pcall">
          {m.callout ? (
            <div className="callout" style={tone(m.callout[3] || 'blocked')}>
              <div className="ct">{m.callout[0]}
                <button type="button" className="copy" id={m.callout[4]} data-copytext={m.callout[1]}
                  onClick={e => { e.stopPropagation(); copy(m.callout![4], m.callout![1]) }}>{flashLabel(m.callout[4], 'copy')}</button>
              </div>
              <div className="cb"><Md text={m.callout[1]} /></div>
              {m.callout[2] ? <div className="cm">{m.callout[2]}</div> : null}
            </div>
          ) : null}
        </div>
        <div className="pkpi">
          {kpis.length ? (
            <div className="kpis">
              {kpis.map((k, i) => (
                <div className="kpi" key={i}><div className="kv">{k!.value}</div>
                  <div className="kl">{k!.label}{k!.failed ? <> {'·'} <span className="bad">{k!.failed + ' failed'}</span></> : null}</div></div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="ptabs" hidden={!m.tabs.length}>
        {m.tabs.length ? (
          <>
            <div className="seg" role="tablist">
              {m.tabs.map(t => (
                <b key={t} className={t === tab ? 'on' : ''} data-tab={t}
                  onClick={() => { storeTab(m.kind, t); setTabs(s => ({ ...s, [m.kind]: t })) }}>
                  {t}{t === 'Calls' ? <span>{m.calls || 0}</span> : t === 'Route' ? <span>{(card.route || []).length}</span> : null}
                </b>
              ))}
            </div>
            {tab === 'Transcript' ? <span className="hint">newest first</span> : null}
          </>
        ) : null}
      </div>
      <div className="pbody" ref={bodyRef}>
        <div className="ptop">{top}</div>
        <div className={listCls}>
          {rows.map(r => {
            const c = dedup.get(r.key) || 0
            dedup.set(r.key, c + 1)
            const isNew = tab === 'Transcript' && seenNow && !seenNow.has(r.key)
            return (
              <div key={r.key + (c ? '#' + c : '')} data-key={r.key} className={r.cls + (isNew ? ' new' : '')}
                onClick={e => {
                  if (!noSel()) return   // a click that ends a selection does not fold/unfold
                  if (tab === 'Calls') {
                    if ((e.target as HTMLElement).closest('.ex')) return
                    const k = ukey + '|' + r.key
                    setOpenCalls(s => ({ ...s, [k]: !s[k] }))
                  } else setExpanded(s => ({ ...s, [r.key]: !s[r.key] }))
                }}>
                {r.children}
              </div>
            )
          })}
        </div>
        <div className="pdoc">{doc}</div>
      </div>
    </div>
  )
}
