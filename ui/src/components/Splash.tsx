import { useEffect, useState } from 'react'
import type { CrewApi } from '../api'
import { injectCss } from '../css'
import { FONT_FACE_CSS } from '../fonts'
import { MARK_URI } from '../mark'
import splashCss from '../styles/splash.css'

const MIN_MS = 1300  // shortest time on screen: the choreography (splash.css) ends at about 1.25 s, then a short hold
const MIN_REDUCED_MS = 500   // reduced motion: static, shown just long enough to read
const MAX_MS = 5000  // a board that never answers must not hold the page
const FADE_MS = 300


// Desktop splash over the page area: mark, eyebrow and headline (the landing page's own words) and a footer with the web address and the plugin version, shown at least
// MIN_MS and until the first board.json has arrived, then faded out over FADE_MS and unmounted. The motion is CSS
// keyframes only (splash.css), switched on by the sp-anim class; with prefers-reduced-motion the class is absent.
const prefersReduced = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
export function Splash({ api }: { api: CrewApi }) {
  const [out, setOut] = useState(false)
  const [gone, setGone] = useState(false)
  const [reduced] = useState(prefersReduced)
  injectCss('splash-fonts', FONT_FACE_CSS)
  injectCss('splash', splashCss)
  useEffect(() => {
    const t0 = Date.now()
    let live = true
    const timers: ReturnType<typeof setTimeout>[] = []
    let started = false
    const leave = () => {
      if (!live || started) return
      started = true
      timers.push(setTimeout(() => {
        if (!live) return
        setOut(true)
        timers.push(setTimeout(() => live && setGone(true), reduced ? 0 : FADE_MS))
      }, Math.max(0, (reduced ? MIN_REDUCED_MS : MIN_MS) - (Date.now() - t0))))
    }
    api.get('/board.json').then(leave, leave)
    timers.push(setTimeout(leave, MAX_MS))
    return () => { live = false; timers.forEach(clearTimeout) }
  }, [api, reduced])
  if (gone) return null
  return (
    <div className={'crew-splash' + (reduced ? '' : ' sp-anim')} data-out={out ? '1' : '0'} role="status" aria-label="Hermes.Crew">
      <div className="sp-in">
        <img className="sp-mark" src={MARK_URI} alt="" />
        <div className="sp-eyebrow"><s /><span className="sp-eb">Hermes.Crew &middot; the agent company for Hermes</span></div>
        <h1 className="sp-title"><span className="sp-w sp-w1">You</span>{' '}<span className="sp-w sp-w2">ask</span>{' '}<em className="sp-w sp-w3">once.</em></h1>
      </div>
      <div className="sp-foot">crew.forgecoreai.com &middot; v{__CREW_VERSION__}</div>
    </div>
  )
}
