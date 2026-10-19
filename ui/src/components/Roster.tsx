import type { CSSProperties } from 'react'
import { roleIcon } from '../card-format'
import { useCardUi } from '../card-ui'

// The role filters as one horizontal strip under the top boxes: click a role to focus its nodes, "all roles" or esc
// for everything. A role's symbol pulses while one of its nodes is running.
export function Roster() {
  const { card, focusRole, setFocusRole } = useCardUi()
  const colour = (c: string): CSSProperties => ({ color: c })
  return (
    <div id="rolestrip">
      <div id="roster">
        <div className={'role all' + (focusRole ? '' : ' on')} onClick={() => setFocusRole(null)}>
          <div className="rl">
            <span className="ricon">{'▦'}</span>
            <span className="rn">{focusRole ? '← show all roles' : 'all roles'}</span>
            <span className="rc">{(card.node_count || 0) + ' nodes'}</span>
          </div>
        </div>
        {(card.roles || []).map(r => (
          <div
            key={r.name}
            className={'role' + (focusRole === r.name ? ' on' : '')}
            title={(r.purpose || '') + (r.active ? ' - working now' : '')}
            onClick={() => setFocusRole(focusRole === r.name ? null : r.name)}
          >
            <div className="rl">
              <span className={'ricon' + (r.active ? ' act' : '')} style={colour(r.color)}>{roleIcon(r.name)}</span>
              <span className="rn" style={colour(r.color)}>{r.name}</span>
              <span className="rc">{r.nodes + (r.nodes === 1 ? ' node' : ' nodes')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
