import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CrewApi } from '../api'
import { CardUiContext, type CardUi } from '../card-ui'
import type { CardJson } from '../card-types'
import { injectCss } from '../css'
import { useCard } from '../data'
import { MARK_URI } from '../mark'
import baseCss from '../styles/base.css'
import cardCss from '../styles/card.css'
import { EventLine } from './EventLine'
import { Graph } from './Graph'
import { Panel } from './Panel'
import { Rail } from './Rail'
import { Roster } from './Roster'
import { Scrubber } from './Scrubber'
import { StatusBar } from './StatusBar'
import { TopArea, type OpenChat } from './TopArea'

export interface CardPageProps {
  api: CrewApi
  id: string
  // Back to the board (the rail button, the overview link, the mark, the o key). The shell navigates.
  onBack(): void
  // Shows the "open chat" button where the host can open a chat session (Desktop, the dashboard tab).
  openChat?: OpenChat
  // Read #node=<id>&tab=<name>&role=<name>&rail=collapsed from the address bar and keep it current (browser only:
  // Desktop owns its own hash).
  hash?: boolean
  // Where the "board" links point (browser: "/").
  boardHref?: string
}

function readRail(): boolean {
  try { return window.localStorage.getItem('crewRailCollapsed') === '1' } catch { return false }
}

// The card page (ui-spec section 5), ported from scripts/crew_dashboard/card.js minus the graph drawing: the event
// line, the top boxes, the role strip, the rail, the step panel, the scrubber and the status bar around <Graph>.
// It polls the card JSON every 2 s and redraws in place: every list is keyed by the data's own keys, so a poll never
// remounts a list, loses a scroll offset or drops a text selection.
export function CardPage({ api, id, onBack, openChat, hash = false, boardHref = '/' }: CardPageProps) {
  injectCss('base', baseCss)
  injectCss('card', cardCss)
  const [paused, setPaused] = useState(false)
  const { card, error, loading, reload } = useCard(api, id, 2000, paused)
  const [selected, setSelected] = useState<string | null>(null)
  const [selStep, setSelStep] = useState(-1)
  const [panelOpen, setPanelOpen] = useState(false)
  const [focusRole, setFocusRole] = useState<string | null>(null)
  const [railCollapsed, setRailCollapsed] = useState(() => readRail() || (hash && /rail=collapsed/.test(window.location.hash)))
  const [help, setHelp] = useState(false)
  const [askedTab, setAskedTab] = useState<{ node: string; tab: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)

  // A different card starts clean.
  useEffect(() => { setSelected(null); setSelStep(-1); setPanelOpen(false); setFocusRole(null) }, [id])

  // Shareable view state: #role=<name> focuses a role, #node=<id> opens that node's panel, &tab=<name> on it.
  useEffect(() => {
    if (!hash) return
    const apply = () => {
      let node: string | null = null, tab: string | null = null
      for (const kv of (window.location.hash || '').replace(/^#/, '').split('&')) {
        const i = kv.indexOf('=')
        if (i < 0) continue
        const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1))
        if (k === 'role') setFocusRole(v || null)
        if (k === 'node' && v) node = v
        if (k === 'tab' && v) tab = v
      }
      if (node) { setSelected(prev => (prev === node ? prev : node)); setPanelOpen(true) }
      if (node && tab) setAskedTab({ node, tab })
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [hash])

  const select = useCallback((nodeId: string) => { setSelected(nodeId); setSelStep(-1); setPanelOpen(true) }, [])
  const selectStep = useCallback((nodeId: string, i: number) => { setSelected(nodeId); setSelStep(i); setPanelOpen(true) }, [])
  const closePanel = useCallback(() => { setSelected(null); setPanelOpen(false) }, [])
  const toggleRail = useCallback(() => {
    setRailCollapsed(c => {
      try { window.localStorage.setItem('crewRailCollapsed', c ? '0' : '1') } catch { /* not remembered */ }
      return !c
    })
  }, [])

  // The keys (card.js keydown). f, F and 0 drive the camera, which lives in <Graph>: they reach it as the key event
  // its own handler listens for.
  const keyRef = useRef({ paused, selected, reload, onBack, closePanel })
  keyRef.current = { paused, selected, reload, onBack, closePanel }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement && document.activeElement.tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      const k = keyRef.current
      if (e.code === 'Space') { e.preventDefault(); setPaused(p => !p) }
      else if (e.key === 'r' || e.key === 'R') k.reload()
      else if (e.key === '?') setHelp(h => !h)
      else if (e.key === 'o' || e.key === 'O') k.onBack()
      else if (e.key === 'f' || e.key === 'F' || e.key === '0') toGraph(root.current, e.key)
      else if (e.key === 'Escape') {
        setHelp(false)
        if (k.selected) k.closePanel()
        else setFocusRole(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // The status bar's follow pill shows the graph's follow state, which the graph reports through onFollowChange.
  const [follow, setFollow] = useState(false)

  const ui: CardUi | null = useMemo(
    () => card && {
      card, api, selected, selStep, focusRole, follow, paused, panelOpen, select, selectStep, closePanel, setFocusRole,
      setFollow: () => toGraph(root.current, 'F'), suppressClick
    },
    [card, api, selected, selStep, focusRole, follow, paused, panelOpen, select, selectStep, closePanel]
  )

  if (!card || !ui)
    return (
      <div className="page-card crew-scope" ref={root} data-card={id}>
        <div style={{ padding: 16 }}>{error ? 'Crew could not load: ' + error : loading ? 'Loading...' : ''}</div>
      </div>
    )
  return (
    <CardUiContext.Provider value={ui}>
      <div className="page-card crew-scope" ref={root} data-card={card.card_id}>
        <a className="brand" href={boardHref} title="overview" aria-label="crew overview" onClick={e => {
          if (e.button || e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          onBack()
        }}><img src={MARK_URI} alt="" width={26} height={26} /></a>
        <EventLine card={card} />
        <div id="main">
          <TopArea card={card} openChat={openChat} onAction={reload} />
          <Roster />
          <div id="row">
            <Rail card={card} collapsed={railCollapsed} onToggle={toggleRail} onBack={onBack} href={boardHref} />
            <Graph
              card={card as unknown as Parameters<typeof Graph>[0]['card']}
              api={api}
              selectedId={panelOpen ? selected : null}
              focusRole={focusRole}
              onFollowChange={setFollow}
              onSelect={(nodeId, step) => { if (nodeId === null) closePanel(); else if (step !== undefined) selectStep(nodeId, step); else select(nodeId) }}
            />
            <Panel hash={hash} askedTab={askedTab} onTabApplied={() => setAskedTab(null)} />
          </div>
        </div>
        <Scrubber />
        <StatusBar card={card} paused={paused} follow={follow} onFollow={() => toGraph(root.current, 'F')} onBack={onBack} href={boardHref} />
        <Help open={help} />
      </div>
    </CardUiContext.Provider>
  )
}

// Hands a key to the graph's own handler (it listens on its wrapper, which React reaches by bubbling).
function toGraph(root: HTMLElement | null, key: string) {
  const g = root && root.querySelector('.crew-graph')
  if (g) g.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

function Help({ open }: { open: boolean }) {
  const row = (k: string, text: string) => <div className="row"><kbd>{k}</kbd>{text}</div>
  return (
    <div id="help" className={open ? 'open' : ''}>
      <div className="h">keys</div>
      {row('space', 'pause / resume polling')}
      {row('r', 'refresh once')}
      {row('f', 'fit view')}
      {row('0', 'reset zoom')}
      {row('F', 'follow the newest active node')}
      <div className="row"><kbd>wheel</kbd>zoom - <kbd>drag</kbd>pan - zoomed out, cards become status blocks</div>
      {row('?', 'toggle this help')}
      {row('o', 'open overview')}
      {row('esc', 'close help, clear role focus')}
    </div>
  )
}

export type { CardJson }
