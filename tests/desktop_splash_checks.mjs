// Splash and nav-prefs checks (ui/src/components/Splash.tsx, ui/src/styles/splash.css, ui/src/desktop.tsx), called by
// desktop_plugin_harness.mjs. Each case imports a FRESH copy of the generated plugin (the splash shows once per module =
// per app session) against a stub SDK; the one that exports SIDEBAR_NAV_PREFS_AREA stands for a current Hermes Desktop.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function splashChecks({ tmp, rewritten, React, createRoot, window, document, ok, eq, board }) {
  let n = 0
  const load = async (withPrefs) => {
    const id = ++n
    if (withPrefs) fs.writeFileSync(path.join(tmp, 'sdk-prefs.mjs'), fs.readFileSync(path.join(tmp, 'sdk.mjs'), 'utf8') + "\nexport const SIDEBAR_NAV_PREFS_AREA = 'sidebarNav.prefs'\n")
    const file = path.join(tmp, `plugin-s${id}.mjs`)
    fs.writeFileSync(file, withPrefs ? rewritten.replace('"./sdk.mjs"', '"./sdk-prefs.mjs"') : rewritten)
    return (await import(pathToFileURL(file).href + '?v=s' + id)).default
  }
  const wait = ms => React.act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const click = el => React.act(async () => { el.click() })
  const mountKeep = async render => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await React.act(async () => { root.render(render()) })
    return { host, done: async () => { await React.act(async () => { root.unmount() }); host.remove() } }
  }
  const mkCtx = (store, extra = {}) => {
    const log = { reg: [], disposed: [], many: [], sets: [] }
    return { log, ctx: {
      registerMany: cs => log.many.push(...cs),
      register: c => { log.reg.push(c); return () => log.disposed.push(c.id) },
      storage: { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; log.sets.push([k, v]) } },
      rest: async () => board, ...extra } }
  }

  // --- the splash: animation classes, words in order, the overlay is the page root's own box
  const p1 = await load(false)
  const a = mkCtx({}); p1.register(a.ctx)
  const m1 = await mountKeep(a.log.many[0].render)
  const sp = m1.host.querySelector('.crew-splash')
  ok(sp && sp.classList.contains('sp-anim'), 'the overlay carries the sp-anim class when motion is allowed')
  const words = [...sp.querySelectorAll('h1 > .sp-w')]
  eq(words.map(w => w.textContent), ['You', 'ask', 'once.'], 'the headline words are separate spans, in order')
  eq(words.map(w => w.tagName), ['SPAN', 'SPAN', 'EM'], 'the last word is the emphasised one')
  eq(words.map(w => w.className), ['sp-w sp-w1', 'sp-w sp-w2', 'sp-w sp-w3'], 'each word has its own animation class')
  ok(sp.querySelector('.sp-eyebrow > s') && sp.querySelector('.sp-eyebrow > .sp-eb'), 'the eyebrow has a rule and a text span')
  const ver = fs.readFileSync(new URL('../plugin.yaml', import.meta.url), 'utf8').match(/^version:\s*(\S+)/m)[1]
  const foot = sp.querySelector('.sp-foot')
  ok(foot && foot.parentElement === sp, 'the footer sits in the overlay, outside the animated block')
  eq(foot.textContent, 'crew.forgecoreai.com \u00b7 v' + ver, 'the footer reads the web address and the plugin.yaml version')
  ok(/\.sp-foot\{position:absolute; left:0; right:0; bottom:88px; text-align:center; font-family:CrewMono/.test([...document.head.querySelectorAll('style')].map(e => e.textContent).join('\n')), 'the footer is bottom-centre, in the CrewMono face')
  ok(sp.parentElement.classList.contains('crew-scope'), 'the overlay is a child of the page root')
  ok(/position:\s*relative/.test(sp.parentElement.getAttribute('style')) && /height:\s*100%/.test(sp.parentElement.getAttribute('style')), 'the page root is the positioned, full-height box')
  const css = [...document.head.querySelectorAll('style')].map(e => e.textContent).join('\n')
  ok(/\.crew-splash\{position:absolute; inset:0;/.test(css), 'the overlay is position:absolute; inset:0')
  const noPref = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'))
  ok(/crew-splash\.sp-anim \.sp-mark\{animation/.test(noPref) && /sp-w3\{animation:crew-sp-last/.test(noPref), 'the keyframes sit under prefers-reduced-motion: no-preference')
  ok(!/@keyframes[^{]*\{[^]*?(width|height|top|left)\s*:/.test(css.slice(css.indexOf('@keyframes crew-sp-mark'), css.indexOf('@keyframes crew-sp-word'))), 'the keyframes move transform and opacity only')
  await m1.done()

  // --- reduced motion: static, no animation class
  const realMM = window.matchMedia
  window.matchMedia = q => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
  try {
    const p2 = await load(false)
    const b = mkCtx({}); p2.register(b.ctx)
    const m2 = await mountKeep(b.log.many[0].render)
    const sp2 = m2.host.querySelector('.crew-splash')
    ok(sp2 && !sp2.classList.contains('sp-anim'), 'with reduced motion the overlay renders without the animation class')
    ok(sp2.querySelector('h1').textContent === 'You ask once.', 'and still reads the headline')
    ok(sp2.querySelector('.sp-foot'), 'and still shows the footer')
    await wait(1000)
    ok(!m2.host.querySelector('.crew-splash'), 'and hides after the short static minimum')
    await m2.done()
  } finally { window.matchMedia = realMM }

  // --- nav prefs: Crew hides the app's Kanban row (kanban plugin 'kanban' + nav id 'nav' = 'kanban:nav') by default
  const p3 = await load(true)
  const store = {}
  const c = mkCtx(store); p3.register(c.ctx)
  eq(c.log.reg.map(r => [r.area, r.data]), [['sidebarNav.prefs', { hide: ['kanban:nav'] }]], 'register() contributes sidebarNav.prefs hiding kanban:nav by default')
  const m3 = await mountKeep(c.log.many[0].render)
  await wait(20)
  const sw = m3.host.querySelector('.kswitch input')
  ok(sw && sw.getAttribute('role') === 'switch' && sw.checked === false, 'the header has the "Show Hermes Kanban row" switch, off by default')
  ok(m3.host.querySelector('.kswitch').textContent === 'Show Hermes Kanban row', 'the switch label')
  await click(sw)
  eq(c.log.disposed, ['nav-prefs'], 'turning it on disposes the hide contribution')
  eq(store, { hideKanbanRow: false }, 'and stores hideKanbanRow=false')
  await click(m3.host.querySelector('.kswitch input'))
  eq(c.log.reg.length, 2, 'turning it off contributes the hide again')
  eq(store, { hideKanbanRow: true }, 'and stores hideKanbanRow=true')
  await m3.done()
  const stored = { hideKanbanRow: false }
  const d = mkCtx(stored); p3.register(d.ctx)
  eq(d.log.reg.length, 0, 'a stored false means no hide contribution on register')
  const m4 = await mountKeep(d.log.many[0].render)
  await wait(20)
  ok(m4.host.querySelector('.kswitch input').checked === true, 'and the switch shows on')
  await m4.done()

  // --- an older shell (no SIDEBAR_NAV_PREFS_AREA): nothing is contributed, no switch
  const p5 = await load(false)
  const e = mkCtx({}); p5.register(e.ctx)
  eq(e.log.reg.length, 0, 'a shell without the prefs area gets no contribution')
  const m5 = await mountKeep(e.log.many[0].render)
  await wait(20)
  ok(!m5.host.querySelector('.kswitch'), 'and no switch')
  await m5.done()
}
