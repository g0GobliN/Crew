import type { CSSProperties, MouseEvent } from 'react'
import type { CrewApi } from '../api'
import { useAvatar } from '../avatars'
import type { Tile } from '../types'
import { TileActions } from './ActionBar'
import { fmt, QUIET_S, shortId, TONE } from './boardUtil'

const tone = (v: string) => ({ '--tone': v }) as CSSProperties

function Chip({ text, kind }: { text: string; kind: string }) {
  return <span className="schip" style={tone('var(--crew-tone-' + kind + ')')}>{text}</span>
}

// The state slot: live -> working . 4m . step 23 . last: terminal (or no heartbeat), queued, or the verdict of a
// finished card. Every state reads as a chip tinted in its own tone.
function State({ t }: { t: Tile }) {
  const a = t.active
  if (a) {
    if (a.quiet_s !== null && a.quiet_s !== undefined && a.quiet_s > QUIET_S) return <Chip text="no heartbeat" kind="review" />
    let facts = ''
    if (a.steps) facts += ' · step ' + (+a.steps || 0)
    if (a.last_tool) facts += ' · last: ' + a.last_tool
    return <Chip text={'working · ' + fmt(+a.for_s) + facts} kind="running" />
  }
  if (t.status === 'ready' || t.status === 'todo') return <Chip text="queued" kind="ready" />
  if (t.status === 'blocked' || t.status === 'triage') return <Chip text={t.status === 'triage' ? 'needs you' : 'blocked'} kind="blocked" />
  if (t.status === 'review') return <Chip text="in review" kind="review" />
  if (t.status !== 'done') return null
  if (t.verdict === 'PASS') return <Chip text="✓ verified" kind="running" />
  if (t.verdict === 'FAIL') return <Chip text="✕ verify failed" kind="blocked" />
  if (t.verdict === 'unverified') return <Chip text="○ unverified" kind="review" />
  return <Chip text="done" kind="done" />
}

function Avatar({ api, name, hue }: { api: CrewApi; name: string; hue?: string }) {
  const src = useAvatar(api, name)
  if (name) return <img className="avatar face" src={src} alt={name} title={name} />
  return <span className="avatar" style={{ '--hue': hue || 'var(--crew-text-3)' } as CSSProperties}>?</span>
}

// One tile: same DOM and class names as board.js cardHTML.
export function CardTile({ t, lane, api, onOpen }: { t: Tile; lane: string; api: CrewApi; onOpen(id: string): void }) {
  const who = t.active ? t.active.profile : t.role || t.assignee || 'unassigned'
  const b = t.budget
  const quiet = !!t.active && t.active.quiet_s !== null && t.active.quiet_s !== undefined && t.active.quiet_s > QUIET_S
  const motion = t.active ? (quiet ? ' quiet' : ' live') : ''
  const open = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return   // new tab / window keeps the link
    e.preventDefault()
    onOpen(t.id)
  }
  return (
    <a className={'card' + motion} data-id={t.id} href={'/card/' + t.id} style={tone(TONE[t.status] || 'var(--crew-tone-neutral)')} onClick={open}>
      <div className="ti">{t.title || '(untitled)'}</div>
      {t.summary ? <div className="su">{t.summary}</div> : null}
      <div className="ft">
        <Avatar api={api} name={who === 'unassigned' ? '' : who} hue={t.color} />
        <span className="who">{who}</span>
        <State t={t} />
        <span className="r">
          {t.runs !== undefined && t.runs > 1 ? <span title="runs">↻ {+t.runs || 0}</span> : null}
          {b && b.pct >= 80 ? (
            <span className={b.pct >= 100 ? 'bad' : 'warn'} title={'token budget: ' + (+b.used || 0) + ' of ' + (+b.ceiling || 0)}>
              {Math.round(b.pct)}%
            </span>
          ) : null}
          <span title="time in this state">{fmt(t.settled_s !== null && t.settled_s !== undefined ? t.settled_s : t.age_s)}</span>
          <span className="id" title={t.id}>{shortId(t.id)}</span>
        </span>
      </div>
      <TileActions t={t} lane={lane} />
    </a>
  )
}
