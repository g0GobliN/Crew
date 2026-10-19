import { briefFields } from '../card-format'
import type { CardJson } from '../card-types'

// The brief block in the rail: the exact words the coordinator was given, never re-worded.
export function Brief({ card }: { card: CardJson }) {
  const b = briefFields(card.nodes || [])
  return (
    <div id="briefsec" hidden={!b}>
      <div className="rh">brief</div>
      <div id="briefText">{b ? b.text : ''}</div>
      <div id="briefSrc">{b ? b.src : ''}</div>
    </div>
  )
}
