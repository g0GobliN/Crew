import type { CardJson } from '../card-types'

// The bottom bar: live/paused, the card's title, the roles at work, the follow toggle, counts and key hints.
export function StatusBar({ card, paused, follow, onFollow, onBack, href = '/' }:
  { card: CardJson; paused: boolean; follow: boolean; onFollow: () => void; onBack: () => void; href?: string }) {
  const act = (card.roles || []).filter(r => r.active).map(r => r.name)
  return (
    <div id="statusbar">
      <span className="pill">crew</span>
      <span className={'live' + (paused ? ' paused' : '')} id="live">{paused ? 'PAUSED' : 'LIVE'}</span>
      <span className="cardtitle" id="cardtitle">{card.card_title || card.card_id || ''}</span>
      <span className="pill" id="ractive">{'roles active: ' + (act.length ? act.join(', ') : 'none')}</span>
      <span className={'pill btn' + (follow ? ' on' : '')} id="followbtn" onClick={onFollow}>{'follow ' + (follow ? 'on' : 'off')}</span>
      <span className="meta">
        <span id="counts">{(card.node_count || 0) + ' nodes - ' + (card.edge_count || 0) + ' edges'}</span>
        <a href={href} onClick={e => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onBack() }}>overview</a>
        <span className="hints">space pause - r refresh - f or double-click fit - 0 zoom - F follow - ? help - o overview</span>
      </span>
    </div>
  )
}
