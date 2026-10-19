import { tickTime } from '../card-format'
import { getSelectedNode } from '../card-model'
import { useCardUi } from '../card-ui'

// The time scrubber under the graph: one diamond per step of the selected node, the newest the playhead. A tick
// selects that step (and opens the panel on its node).
export function Scrubber() {
  const { card, selected, selStep, selectStep } = useCardUi()
  const sel = getSelectedNode(card, selected)
  const steps = sel ? sel.steps || [] : []
  return (
    <div id="scrubwrap">
      <div id="scrubber">
        <div className="track" />
        {!steps.length ? <span className="tl left">no steps</span> : (
          <>
            <span className="tl left">{tickTime(steps[0])}</span>
            <span className="tl right">{tickTime(steps[steps.length - 1])}</span>
            {steps.map((_s, i) => (
              <div
                key={i}
                className={'tick' + (i === selStep ? ' active' : '') + (i === steps.length - 1 ? ' playhead' : '')}
                style={{ left: (steps.length === 1 ? 50 : (i / (steps.length - 1)) * 100) + '%' }}
                onClick={() => selectStep(sel!.id, i)}
              ><div className="diam" /></div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
