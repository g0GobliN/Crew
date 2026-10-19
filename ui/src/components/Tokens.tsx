import { budgetTone, fmtExact } from '../card-format'
import type { CardJson } from '../card-types'

// The rail's token block: exact figures with thousands separators, never k/M; the share of the ceiling slides
// green -> yellow -> red.
export function Tokens({ card }: { card: CardJson }) {
  const t = card.tokens || {}
  const ceil = +(t.ceiling || 0), used = +(t.used || 0)
  const pct = ceil ? Math.round((1000 * used) / ceil) / 10 : 0
  const row = (id: string, label: string, value: string, color?: string) => (
    <div className="tokrow" id={id}><span className="tk">{label}</span><span className="tv" style={color ? { color } : undefined}>{value}</span></div>
  )
  return (
    <div id="toksec">
      <div className="rh">tokens</div>
      {row('tokCeiling', 'ceiling', fmtExact(ceil))}
      {row('tokUsed', 'used (billed)', fmtExact(used))}
      {row('tokRaw', 'raw total', fmtExact(t.raw_total))}
      {row('tokCalls', 'api calls', fmtExact(t.calls))}
      {row('tokPct', 'of ceiling', pct.toFixed(1) + '%', ceil ? budgetTone(pct) : undefined)}
    </div>
  )
}
