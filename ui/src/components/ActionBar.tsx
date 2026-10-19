import { useEffect, useRef, useState } from 'react'
import { coordinatorTarget } from '../card-format'
import type { CardJson } from '../card-types'
import type { Tile } from '../types'
import { useCrewHost, type ActionName } from '../host'
import type { OpenChat } from './TopArea'

// What the rules read, from a card page (situation) or a board tile alike.
export interface ActionSubject {
  status: string
  proof_ask: string
  live: boolean
}

export const cardSubject = (card: CardJson): ActionSubject => ({
  status: card.card_status || '',
  proof_ask: card.situation?.proof_ask || '',
  live: !!card.situation?.live_run
})

// Which buttons can act on this card now. Each rule is the one its command states:
//   unstuck: crew_card.unstuck_card accepts a card in triage or blocked, and one /crew-stop parked (scheduled);
//   retry:   crew_card.retry_card re-arms a finished or stopped card (done, blocked, failed, or triage);
//   proof:   the card has a proof question waiting for the owner (proof_ask, crew_card.pending_proof_ask);
//   stop:    a run is alive.
export function actionStates(s: ActionSubject): Record<ActionName, boolean> {
  const st = s.status
  return {
    unstuck: st === 'triage' || st === 'blocked' || st === 'scheduled',
    retry: st === 'done' || st === 'blocked' || st === 'failed' || st === 'triage',
    proof: !!s.proof_ask,
    stop: s.live
  }
}

const WHY_NOT: Record<ActionName, string> = {
  unstuck: 'only a blocked, triage or stopped card can be unstuck',
  retry: 'only a done, blocked or failed card can be retried',
  proof: 'no proof question is waiting for you on this card',
  stop: 'no run is alive on this card'
}
const WHAT: Record<ActionName, string> = {
  unstuck: 'lift the block so the card runs again (/crew-unstuck)',
  retry: 'raise the budget and run the card again',
  proof: 'give the go for the proof the coordinator asked about (/crew-proof)',
  stop: 'park the card and stop its run (/crew-stop)'
}
const LABEL: Record<ActionName, string> = { unstuck: 'Unstuck', retry: 'Retry', proof: 'Proof', stop: 'Stop' }
const SHOW_MS = 6000

type Msg = { ok: boolean; text: string }
const NAMES: ActionName[] = ['unstuck', 'retry', 'proof', 'stop']

// The four command buttons, one rule set for the card page and the board tile: Unstuck, Retry, Proof, Stop (behind
// the app's confirm dialog). Proof is drawn only while the card has a proof question waiting (then it is enabled). Draws nothing without the host's actions. compact = the tile's row (no ids, since a
// board shows many); the card page keeps its #act-* ids. onResult gets the answer text, onDone fires after it.
export function ActionButtons({ subject, card, compact, only, onResult, onDone }: {
  subject: ActionSubject; card: string; compact?: boolean; only?: ActionName[]; onResult(m: Msg): void; onDone(): void
}) {
  const { actions } = useCrewHost()
  const [busy, setBusy] = useState<ActionName | null>(null)
  if (!actions) return null
  const { Button } = actions
  const on = actionStates(subject)
  const press = async (name: ActionName) => {
    if (busy || !on[name]) return
    const extra: Record<string, unknown> = {}
    if (name === 'stop') {
      if (!(await actions.confirm('Stop this card?', 'Its run is killed and the card is parked with its history. /crew-unstuck continues it.'))) return
      extra.confirm = true
    }
    if (name === 'proof') {
      // "blocked": Hermes flagged the command, so the owner's go is brave (a safety bypass, asked first); "rescope" is a plain yes.
      const brave = subject.proof_ask !== 'rescope'
      if (brave && !(await actions.confirm('Run the flagged proof?', 'Hermes flagged this proof command as dangerous. Brave runs it for this card anyway.'))) return
      extra.mode = brave ? 'brave' : 'yes'
    }
    setBusy(name)
    try {
      onResult(await actions.run(name, card, extra))
    } catch (e) {
      onResult({ ok: false, text: LABEL[name] + ' failed: ' + (e instanceof Error ? e.message : String(e)) })
    }
    setBusy(null)
    onDone()
  }
  return (
    <>
      {NAMES.filter(n => (!only || only.includes(n)) && (n !== 'proof' || on.proof)).map(n => (
        <Button
          key={n}
          id={compact ? undefined : 'act-' + n}
          size="xs"
          variant={n === 'stop' ? 'destructive' : n === 'proof' ? 'default' : 'outline'}
          disabled={!on[n] || !!busy}
          title={on[n] ? WHAT[n] : WHY_NOT[n]}
          onClick={() => { void press(n) }}
        >{LABEL[n]}</Button>
      ))}
    </>
  )
}

// The answer of a command shows for a few seconds, then goes.
function useFlash(reset: string): [Msg | null, (m: Msg) => void] {
  const [msg, setMsg] = useState<Msg | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => { setMsg(null) }, [reset])
  return [msg, (m: Msg) => {
    setMsg(m)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), SHOW_MS)
  }]
}

// The Desktop button bar of the card page: the four buttons and Open chat. It exists only where the host brings
// actions (Desktop); the browser draws nothing here. The answer shows under the bar and the page polls again at once.
export function ActionBar({ card, openChat, onDone }: { card: CardJson; openChat?: OpenChat; onDone(): void }) {
  const { actions } = useCrewHost()
  const [msg, show] = useFlash(card.card_id)
  if (!actions) return null
  const { Button } = actions
  const target = coordinatorTarget(card.coordinator)
  return (
    <div id="actionbar" className="actionbar">
      <div className="abtns">
        <ActionButtons subject={cardSubject(card)} card={card.card_id} onResult={show} onDone={onDone} />
        {target && openChat ? (
          <Button id="act-chat" size="xs" variant="ghost" title="open the chat this card came from"
            onClick={() => openChat(target.profile, target.session)}>{'Open chat'}</Button>
        ) : null}
      </div>
      {msg ? <div id="actionmsg" role="status" className={'amsg' + (msg.ok ? '' : ' bad')}>{msg.text}</div> : null}
    </div>
  )
}

// The compact row under a board tile's chips (Desktop only; nothing without the host's actions): only on a card in
// the Needs-you lane (blocked), and only Unstuck, Retry and Proof; Stop stays on the card page. A click here must
// not open the card, so it stops at this wrapper. The board's own poll picks the change up within two seconds.
export function TileActions({ t, lane }: { t: Tile; lane: string }) {
  const { actions } = useCrewHost()
  const [msg, show] = useFlash(t.id)
  if (!actions || lane !== 'blocked') return null
  const subject: ActionSubject = { status: t.status, proof_ask: t.proof_ask || '', live: !!t.active }
  return (
    <div className="tact" onClick={e => { e.preventDefault(); e.stopPropagation() }}>
      <div className="tbtns">
        <ActionButtons compact only={['unstuck', 'retry', 'proof']} subject={subject} card={t.id} onResult={show} onDone={() => {}} />
      </div>
      {msg ? <div role="status" className={'tmsg' + (msg.ok ? '' : ' bad')}>{msg.text}</div> : null}
    </div>
  )
}
