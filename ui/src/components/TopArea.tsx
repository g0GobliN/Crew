import { useState, type CSSProperties } from 'react'
import { copyText, coordinatorTarget, fmtAge, toneVar } from '../card-format'
import type { CardJson } from '../card-types'
import { useCrewHost } from '../host'
import { ActionBar } from './ActionBar'

const tone = (word?: string) => ({ '--tone': toneVar(word) }) as CSSProperties

// A copy button whose label flashes "copied" for 1.6 s (card.js COPYFLASH), then reads "copy" again.
function CopyButton({ id, title, text, className = 'copy', label = 'copy', stop = true }:
  { id: string; title: string; text: () => string; className?: string; label?: string; stop?: boolean }) {
  const [shown, setShown] = useState(label)
  return (
    <button
      type="button"
      className={className}
      id={id}
      title={title}
      aria-label={title}
      onClick={e => {
        if (stop) e.stopPropagation()
        copyText(text(), ok => {
          setShown(ok ? 'copied' : 'select + copy')
          setTimeout(() => setShown(label), 1600)
        })
      }}
    >{shown}</button>
  )
}

function Field({ label, value, copy }: { label: string; value: string; copy?: { id: string; title: string } }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <span className="fp">
      <span className="fk">{label}</span>
      <span className="fv" title={value}>{value}</span>
      {copy ? <CopyButton id={copy.id} title={copy.title} text={() => value} /> : null}
    </span>
  )
}

export type OpenChat = (profile: string, session: string) => void

// The top of the card page: the card's own state and fields, the pending reason (or the done report) and the
// repeated-stops note. Three boxes, the third only when the card is looping.
export function TopArea({ card, openChat, onAction }: { card: CardJson; openChat?: OpenChat; onAction?: () => void }) {
  const { actions } = useCrewHost()
  const s = card.situation || {}
  const cls = s.headline && s.headline.indexOf('stopped') === 0 ? 'blocked'
    : s.headline === 'finished' ? 'done' : s.headline && s.headline.indexOf('working') === 0 ? 'running' : ''
  const st = card.card_status || '-'
  const fp = s.first_pass || {}
  const un = s.units || {}
  const kids = (s.children || []).length
  const target = coordinatorTarget(card.coordinator)

  // A done card shows its done report (the text the owner is sent); any other card its pending reason.
  const report = card.card_status === 'done' ? card.report || '' : ''
  const reason = report || s.reason || s.why || ''
  const you = (s.reason_actor || (s.reason ? 'nobody' : '')) === 'you' || cls === 'blocked'
  const age = s.reason_age_s

  const spinText = s.repeat_text || ''
  const quiet = !s.repeat || !spinText

  return (
    <div id="toparea" className={quiet ? 'two' : ''}>
      <div className="tcell" id="topSit">
        <div className="tch">card</div>
        <div id="sit" className="sit">
          <span className="pill sh" style={tone(st)}><i />{st}</span>
          <span className={'pill sb ' + cls} style={tone(cls || 'pending')}>{s.headline || '-'}</span>
          {fp.rounds ? (
            <span className={'pill sb ' + (fp.first_pass ? 'done' : 'blocked')} style={tone(fp.first_pass ? 'PASS' : 'FAIL')}>
              {fp.first_pass ? 'passed first try' : +(fp.passes || 0) ? (+(fp.fails || 0)) + ' fail(s) before pass' : 'check failed'}
            </span>
          ) : null}
          {un.total ? (
            <span className="pill sd" style={tone((un.passed || 0) >= un.total ? 'PASS' : 'pending')}>
              {'units ' + (+(un.passed || 0)) + ' of ' + (+un.total) + ' passed'}
            </span>
          ) : null}
          {kids ? <span className="pill sd" style={tone('pending')}>{'children ' + kids}</span> : null}
        </div>
        <div id="sitfields" className="fields">
          <Field label="model" value={card.card_model || ''} />
          {/* fmtAge takes an AGE in seconds, not a timestamp: created_at straight in reads as 20000 days. */}
          {card.card_created_at ? <Field label="started" value={fmtAge(Date.now() / 1000 - card.card_created_at)} /> : null}
          <Field label="kanban id" value={card.card_id || ''} copy={{ id: 'cardIdCopy', title: 'copy the kanban id' }} />
          <Field label="coordinator" value={card.coordinator || ''} copy={{ id: 'cardCoCopy', title: 'copy the coordinator session' }} />
          {/* The open chat button, on its own row, exists only where the host offers a chat to open. */}
          {target && openChat && !actions ? (
            <>
              <span className="brk" />
              <span className="fp openrow">
                <button
                  type="button"
                  className="copy"
                  id="cardCoOpen"
                  title="open the chat this card came from"
                  aria-label="open the chat this card came from"
                  onClick={e => { e.stopPropagation(); openChat(target.profile, target.session) }}
                >{'open chat ↗'}</button>
              </span>
            </>
          ) : null}
        </div>
        {/* Desktop only: the commands for this card (the bar draws nothing without host actions) */}
        <ActionBar card={card} openChat={openChat} onDone={onAction || (() => {})} />
      </div>
      <div className="tcell" id="topWhy">
        <div className="tch" id="whyHead">{report ? 'done report' : 'pending reason'}</div>
        <div className="tce" id="sitboxNone" hidden={!!reason}>nothing pending</div>
        <div id="sitbox" hidden={!reason} className={!reason ? undefined : report ? 'done' : you ? 'you' : 'nobody'}>
          <div id="sitboxHead">
            <span className="sbl">{report ? 'delivered' : you ? 'needs you' : 'waiting - nobody has to act'}</span>
            <span className={report ? 'sb done' : 'sb ' + cls}>
              {report ? 'done' : (card.card_status || '-') + (s.headline ? ' - ' + s.headline : '')}
            </span>
            {/* the identifier rides along with the copy so the card can be found at once; the box shows the reason alone */}
            <CopyButton id="sitCopy" title="copy the pending reason" text={() => (card.card_id ? card.card_id + '\n\n' : '') + reason} />
          </div>
          <div id="sitboxWhy">{reason}</div>
          <div id="sitboxMeta">
            {report ? 'what the owner is sent when the card ends'
              : 'source: ' + (s.reason_source || 'task') + ' - recorded ' + fmtAge(age) + (age !== null && age !== undefined ? ' (' + age + 's)' : '')}
          </div>
        </div>
      </div>
      <div className="tcell" id="topSpin" hidden={quiet}>
        <div className="tch">repeated stops</div>
        <div className="tce" id="spinboxNone" hidden={!quiet}>not spinning</div>
        <div id="spinbox" hidden={quiet}>
          <div id="spinboxHead">
            <span id="spinboxCount">{(s.repeat_stops || 0) + ' of ' + (s.runs || 0) + ' runs stopped on the same reason'}</span>
            <span className="sbl">spinning</span>
            <CopyButton id="spinCopy" title="copy the repeated reason" text={() => spinText} />
          </div>
          <div id="spinboxText">{spinText}</div>
        </div>
      </div>
    </div>
  )
}
