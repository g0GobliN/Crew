import type { CardJson } from '../card-types'
import { Brief } from './Brief'
import { Tokens } from './Tokens'

// The left rail: tokens, brief, the way back to the board, and the collapse button. `href` keeps the link a real
// link (middle click, copy address); a plain click goes through onBack so the shell navigates without a reload.
export function Rail({ card, collapsed, onToggle, onBack, href = '/' }:
  { card: CardJson; collapsed: boolean; onToggle: () => void; onBack: () => void; href?: string }) {
  const arrow = collapsed ? '›' : '‹'
  return (
    <div id="rail" className={collapsed ? 'collapsed' : ''}>
      <Tokens card={card} />
      <Brief card={card} />
      <div className="rback">
        <a className="railbtn" href={href} title="back to the board" onClick={e => {
          if (e.button || e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          onBack()
        }}>{'‹'}<span className="rbtnlabel"> board</span></a>
      </div>
      <div className="rbot">
        <button className="railbtn tog" id="railBot" type="button" title={collapsed ? 'expand the sidebar' : 'collapse the sidebar'} onClick={onToggle}>{arrow}</button>
      </div>
    </div>
  )
}
