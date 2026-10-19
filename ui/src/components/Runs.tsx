import type { ReactNode } from 'react'
import { LATEST_N } from '../card-model'
import type { PanelModel } from '../card-model'
import { fmtTime, groupParallel, offLabel, stepStatus, type StepGroup } from '../card-format'
import type { CardNode } from '../card-types'

// `code` spans in prose: a backtick pair becomes <code> (card.js md()); everything else stays text.
export function Md({ text }: { text: unknown }) {
  const parts = String(text === null || text === undefined ? '' : text).split(/`([^`\n]+)`/)
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))}</>
}

export interface Row { key: string; cls: string; children: ReactNode }

// The Transcript tab: the run's own words, newest first, one row per line, keyed by time + start of the text.
// With a host markdown renderer (Desktop: the chat's own) the text is drawn by it, in a <div> (it makes blocks);
// without one it is the plain <p> with `code` spans the browser has always shown.
export function transcriptRows(m: PanelModel, expanded: Record<string, boolean>, renderMarkdown?: (text: string) => ReactNode): Row[] {
  const src: CardNode = m.src || ({} as CardNode)
  const lines = (src.text || []).slice().reverse()
  return lines.map((l, i) => {
    const key = String(l.ts || '') + '|' + String(l.text || '').slice(0, 80)
    return {
      key,
      cls: 'msg' + (i === 0 ? ' first' : '') + (expanded[key] ? ' ex' : ''),
      children: (
        <>
          <time>{i === 0 && m.live ? <i className="livedot" /> : null}{l.ts ? fmtTime(l.ts) : ''}</time>
          {renderMarkdown ? <div className="md">{renderMarkdown(String(l.raw || l.text || ''))}</div> : <p><Md text={l.text} /></p>}
        </>
      )
    }
  })
}

export interface CallGroups { view: string; groups: StepGroup[]; steps: NonNullable<CardNode['steps']> }
export function callGroups(m: PanelModel, views: Record<string, string>): CallGroups {
  const steps = (m.src || ({} as CardNode)).steps || []
  const view = views[m.unit!.key] || ((m.failed || 0) > 0 ? 'failed' : 'latest')
  const picked = view === 'failed' ? steps.filter(s => s.state === 'err') : steps.slice(-LATEST_N)
  return { view, groups: groupParallel(picked).reverse(), steps }
}

// The Calls tab rows: folded by default (failed too), newest first; expanded shows every arg then the state line.
export function callRows(m: PanelModel, cg: CallGroups, open: Record<string, boolean>): Row[] {
  return cg.groups.map(g => {
    const key = g.k + '|' + (g.args[0] || '').slice(0, 24)
    const isOpen = !!open[m.unit!.key + '|' + key]
    const icon = g.state === 'err' ? <span className="st bad">{'✕'}</span>
      : g.state === 'pending' ? <span className="st warn">{'●'}</span> : <span className="st ok">{'✓'}</span>
    const prev = g.state === 'err' && (g.note || g.out) ? g.note || g.out : g.args[0] || ''
    return {
      key,
      cls: 'call' + (isOpen ? ' open' : '') + (g.state === 'err' ? ' failed' : ''),
      children: (
        <>
          {icon}
          <span className="tn">{g.tool + (g.args.length > 1 ? ' ×' + g.args.length : '')}</span>
          <span className="ar">{prev}</span>
          <span className="of">{offLabel(g)}</span>
          {isOpen ? (
            <div className="ex">
              {g.args.filter(a => a).map((a, i) => <div className="ea" key={i}>{a}</div>)}
              <div className={'eo' + (g.state === 'err' ? ' er' : '')}>{stepStatus(g)}</div>
            </div>
          ) : null}
        </>
      )
    }
  })
}

// The head of the Calls tab: Failed / Latest filter, the hint, the per-tool chips, "n earlier ok calls not loaded".
export function CallsHead({ m, cg, onView }: { m: PanelModel; cg: CallGroups; onView: (v: string) => void }) {
  const total = m.calls || cg.steps.length, loaded = cg.steps.length
  const nf = m.failed || 0, latest = Math.min(LATEST_N, loaded)
  const chips = new Map<string, number>()
  for (const t of (m.src || ({} as CardNode)).tool_runs || []) chips.set(t.tool, (chips.get(t.tool) || 0) + t.count)
  const failedLoaded = cg.steps.filter(s => s.state === 'err').length
  const hint = cg.view === 'failed'
    ? nf + ' failed of ' + total + ' calls' + (nf > failedLoaded ? ' (older failures not loaded)' : '')
    : 'latest ' + latest + ' of ' + total + ' calls'
  const notLoaded = Math.max(0, total - loaded)
  return (
    <>
      <div className="calltools">
        <div className="seg cbfilter" role="tablist">
          <b className={cg.view === 'failed' ? 'on' : ''} data-view="failed" onClick={() => onView('failed')}>Failed<span>{nf}</span></b>
          <b className={cg.view === 'latest' ? 'on' : ''} data-view="latest" onClick={() => onView('latest')}>Latest<span>{latest}</span></b>
        </div>
        <span className="hint">{hint}</span>
      </div>
      {chips.size ? (
        <div className="chips">
          {[...chips].map(([t, c]) => <span className="chip" key={t}>{t}<b>{c}</b></span>)}
        </div>
      ) : null}
      {notLoaded ? <div className="nl">{notLoaded + ' earlier ok call' + (notLoaded === 1 ? '' : 's') + ' not loaded'}</div> : null}
    </>
  )
}
