import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import type { CrewApi } from '../api'
import type { Lane as LaneData } from '../types'
import { CardTile } from './CardTile'
import { store, TONE } from './boardUtil'

interface Props {
  lane: LaneData
  api: CrewApi
  archivedOpen: boolean
  older: boolean
  onToggleArchived(): void
  onOlder(on: boolean): void
  onOpenCard(id: string): void
}

// The tiles of one lane; its scroll offset survives a redraw and a board -> card -> back round trip (sessionStorage).
function LaneBody({ laneKey, children }: { laneKey: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const y = +(store('scroll.' + laneKey) || 0)
    if (y && ref.current) ref.current.scrollTop = y
  }, [laneKey])
  return <div className="lbody" ref={ref} onScroll={e => store('scroll.' + laneKey, String(e.currentTarget.scrollTop))}>{children}</div>
}

// One lane: same DOM and class names as board.js laneHTML (a rail when empty or when Archived is collapsed).
export function Lane({ lane: l, api, archivedOpen, older, onToggleArchived, onOlder, onOpenCard }: Props) {
  const tone = { '--tone': TONE[l.key] || 'var(--crew-tone-neutral)' } as CSSProperties
  const n = l.tiles.length + (l.hidden || 0)
  const key = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    fn()
  }
  if (l.key === 'archived' && n && !archivedOpen)
    return (
      <section className="lane rail togglable" data-lane="archived" data-toggle="archived" role="button" tabIndex={0} aria-expanded="false"
        style={tone} title={'Archived: ' + n + ' - click to open'} onClick={onToggleArchived} onKeyDown={key(onToggleArchived)}>
        <div className="lh"><i></i></div><span className="lt">{l.label}</span><span className="ln">{n}</span>
      </section>
    )
  if (!n)
    return (
      <section className="lane rail" data-lane={l.key} style={tone} title={l.label + ': empty'}>
        <div className="lh"><i></i></div><span className="lt">{l.label}</span>
      </section>
    )
  const toggle = l.key === 'archived'
  return (
    <section className="lane" data-lane={l.key} style={tone}>
      <div className="lh"
        {...(toggle ? { 'data-toggle': 'archived', role: 'button', tabIndex: 0, 'aria-expanded': 'true', title: 'click to collapse', onClick: onToggleArchived, onKeyDown: key(onToggleArchived) } : {})}>
        <i></i><span className="lt">{l.label}</span><span className="ln">{n}</span>
      </div>
      <LaneBody laneKey={l.key}>
        {l.tiles.map(t => <CardTile key={t.id} t={t} lane={l.key} api={api} onOpen={onOpenCard} />)}
        {l.hidden && l.key === 'done' ? (
          <button className="more" data-older="1" onClick={() => onOlder(true)}>Show {+l.hidden || 0} older</button>
        ) : l.key === 'done' && older ? (
          <button className="more" data-older="0" onClick={() => onOlder(false)}>Show the newest only</button>
        ) : null}
      </LaneBody>
    </section>
  )
}
