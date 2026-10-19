// Flow graph, minimap and flow pane checks, called by desktop_plugin_harness.mjs. The generated plugin.js exports only its
// default registration, so this bundles ui/src/components/{Graph,FlowPane}.tsx itself (esbuild, react left external and
// pointed at the harness's REAL react) and mounts them for real in jsdom, against a card fetched from the live board
// (tests/fixtures/card.graph.json: 11 nodes, 10 edges, a child card, a failed verifier).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function graphChecks({ req, tmp, React, createRoot, window, document, ok, eq, ui, fixtures }) {
  window.HTMLCanvasElement.prototype.getContext = () => null // jsdom has no 2d context; the minimap must cope
  const { build } = req('esbuild')
  const dir = path.join(tmp, 'graph')
  fs.mkdirSync(dir, { recursive: true })
  const R = req('react')
  fs.writeFileSync(path.join(dir, 'react.mjs'), `import R from '${pathToFileURL(req.resolve('react')).href}'\nexport default R\nexport const { Fragment, ${Object.keys(R).filter(k => k !== 'Fragment' && /^[A-Za-z_$][\w$]*$/.test(k)).join(', ')} } = R\n`)
  fs.writeFileSync(path.join(dir, 'jsx.mjs'), `import R from '${pathToFileURL(req.resolve('react/jsx-runtime')).href}'\nexport const { jsx, jsxs, Fragment } = R\n`)
  const uiPosix = ui.split(path.sep).join('/')   // an import specifier, so forward slashes: a Windows path's backslashes are escapes in a string literal
  fs.writeFileSync(path.join(dir, 'entry.tsx'), `export { Graph } from '${uiPosix}/src/components/Graph'\nexport { FlowPane } from '${uiPosix}/src/components/FlowPane'\nexport { setCardPageOpen, cardPageOpen } from '${uiPosix}/src/card-open'\n`)
  await build({
    entryPoints: [path.join(dir, 'entry.tsx')], outfile: path.join(dir, 'bundle.mjs'), bundle: true, format: 'esm', platform: 'neutral',
    external: ['react', 'react/jsx-runtime'], loader: { '.css': 'text' }, jsx: 'automatic', jsxImportSource: 'react', logLevel: 'warning',
    absWorkingDir: ui, mainFields: ['module', 'main']
  })
  const src = fs.readFileSync(path.join(dir, 'bundle.mjs'), 'utf8')
    .replace(/(from )"react\/jsx-runtime"/g, '$1"./jsx.mjs"').replace(/(from )"react"/g, '$1"./react.mjs"')
  fs.writeFileSync(path.join(dir, 'bundle2.mjs'), src)
  const { Graph, FlowPane, setCardPageOpen, cardPageOpen } = await import(pathToFileURL(path.join(dir, 'bundle2.mjs')).href)

  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, 'card.graph.json'), 'utf8'))
  const api = { get: async () => { throw new Error('the graph makes no request') }, post: async () => ({}) }
  const wait = ms => React.act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const click = el => React.act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  async function mount(render) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await React.act(async () => { root.render(render()) })
    await wait(10)
    return { host, done: async () => { await React.act(async () => { root.unmount() }); host.remove() } }
  }

  // --- Graph: nodes, edges, classes
  const picks = []
  let m = await mount(() => React.createElement(Graph, { card: fixture, api, onSelect: (id, step) => picks.push([id, step]) }))
  const h = m.host
  const nodeEls = [...h.querySelectorAll('.nodes > .node')]
  eq(nodeEls.length, fixture.nodes.length, 'one .node per fixture node')
  for (const n of fixture.nodes) {
    const el = h.querySelector(`.node[data-id="${n.id}"]`)
    ok(el, 'node element for ' + n.id)
    ok(el.classList.contains('node'), 'node class')
    eq(el.classList.contains('briefcard'), n.kind === 'brief', 'briefcard class only on the brief: ' + n.id)
    ok(el.querySelector('.card .badge') && el.querySelector('.card .hdr .glyph') && el.querySelector('.card .foot .sw.chip-tone') && el.querySelector('.card .cellmark'), 'card structure of ' + n.id)
    ok(el.querySelector('.gold').textContent.startsWith(n.layer + ' - ' + n.kind), 'gold line of ' + n.id)
    eq(el.querySelector('.sw').textContent, n.status, 'status chip text of ' + n.id)
  }
  eq(h.querySelector('.node[data-id="verify:t_d3c396cd"] .glyph').textContent, '✗', 'a failed node shows the failed glyph')
  ok(h.querySelector('.node[data-id="run:3"] .gold').textContent.endsWith('- card t_d4bba221'), 'a child card names its card')
  eq(h.querySelectorAll('.edges path.edge:not(.flow)').length, fixture.edges.length, 'one edge path per fixture edge')
  eq(h.querySelectorAll('.edges marker').length, 2, 'two arrow markers')
  eq(h.querySelectorAll('.nodes .node.alive, .edges .edge.live').length, 0, 'a finished card has nothing live')
  const sessionNode = fixture.nodes.find(n => n.kind === 'session')
  ok(h.querySelectorAll(`.node[data-id="${sessionNode.id}"] .step`).length > 0, 'session node lists its step lines')
  ok(h.querySelectorAll(`.node[data-id="${sessionNode.id}"] .chips .chip`).length > 0, 'session node shows tool chips')
  // --- minimap
  const mm = h.querySelector('canvas.minimap')
  ok(mm, 'minimap canvas exists')
  eq([mm.getAttribute('width'), mm.getAttribute('height')], ['200', '130'], 'minimap width/height attributes')
  ok(/^\d+%/.test(h.querySelector('.zoomlbl').textContent), 'zoom label')
  // --- selecting: click toggles sel, the run and its session light together, empty canvas clears
  const runN = fixture.nodes.find(n => n.id === 'run:2')
  const sess = fixture.nodes.find(n => n.kind === 'session' && n.run_id === (runN.evidence || {}).run_id)
  const verN = fixture.nodes.find(n => n.id === 'verify:t_d3c396cd')
  await click(h.querySelector(`.node[data-id="${verN.id}"] .card`))
  eq([...h.querySelectorAll('.node.sel')].map(e => e.dataset.id), [verN.id], 'clicking a node selects it')
  await click(h.querySelector(`.node[data-id="${runN.id}"] .card`))
  const lit = [...h.querySelectorAll('.node.sel')].map(e => e.dataset.id).sort()
  eq(lit, [runN.id, ...(sess ? [sess.id] : [])].sort(), 'selecting moves the class; a run lights with its session')
  eq(picks.at(-1)[0], runN.id, 'onSelect told the host')
  await click(h.querySelector('.stage'))
  eq(h.querySelectorAll('.node.sel').length, 0, 'empty canvas clears the selection')
  eq(picks.at(-1)[0], null, 'onSelect told the host about the clear')
  await m.done()

  // --- a running node: alive class, live edge, travelling dot
  const running = JSON.parse(JSON.stringify(fixture))
  running.nodes.find(n => n.id === 'run:2').status = 'running'
  m = await mount(() => React.createElement(Graph, { card: running, api }))
  eq(m.host.querySelectorAll('.node.alive').length, 1, 'the running node carries the live class')
  eq(m.host.querySelector('.node.alive').dataset.id, 'run:2', 'and it is the running one')
  const liveEdges = m.host.querySelectorAll('.edges path.edge.live')
  eq(liveEdges.length, 1, 'the edge into the running node is live')
  eq(m.host.querySelectorAll('.edges .edge.flow').length, 1, 'with a flow path')
  ok(m.host.querySelector('.edges circle.edge-dot animateMotion[repeatCount="indefinite"]'), 'and a dot travelling on it')
  eq(m.host.querySelectorAll('.edges path.edge:not(.flow)').length, fixture.edges.length, 'edge count unchanged')
  // role focus dims the rest
  await m.done()
  m = await mount(() => React.createElement(Graph, { card: running, api, focusRole: 'verifier' }))
  ok(m.host.querySelectorAll('.node.dim').length > 0 && m.host.querySelectorAll('.node:not(.dim)').length > 0, 'focusRole dims the other roles')
  await m.done()

  // --- the minimap canvas follows its box through a ResizeObserver
  const roCallbacks = []
  globalThis.ResizeObserver = class { constructor(cb) { roCallbacks.push(cb) } observe() {} disconnect() {} }
  m = await mount(() => React.createElement(Graph, { card: fixture, api }))
  const c2 = m.host.querySelector('canvas.minimap')
  Object.defineProperty(c2, 'offsetWidth', { value: 120, configurable: true })
  Object.defineProperty(c2, 'offsetHeight', { value: 78, configurable: true })
  await React.act(async () => { roCallbacks.forEach(cb => cb([])) })
  eq([c2.getAttribute('width'), c2.getAttribute('height')], ['120', '78'], 'minimap attributes follow its container')
  await m.done()
  delete globalThis.ResizeObserver

  // --- FlowPane: a narrow vertical chart of the running card (nodes from the card JSON, sessions left out); the running
  // node is lit; a click on the chart opens the card route; no pan, zoom or minimap; empty state links to the board
  const tile = (id, title, active, extra = {}) => ({ id, title, status: active ? 'running' : 'done', role: 'worker', assignee: 'w', active, ...extra })
  const act = { profile: 'w', run: 2, for_s: 75, steps: 7, last_tool: 'terminal' }
  let board = { generated_at: 1, live: 1, cards: 3, counts: {}, lanes: [
    { key: 'blocked', label: 'Needs you', hidden: 0, tiles: [tile('t_need0001', 'Needs a decision', null, { status: 'blocked', role: 'verifier' })] },
    { key: 'running', label: 'Working', hidden: 0, tiles: [tile(fixture.card_id, 'The live one', act)] },
    { key: 'done', label: 'Done', hidden: 0, tiles: [tile('t_d4bba221', 'not live', null)] }] }
  const liveCard = JSON.parse(JSON.stringify(fixture))
  liveCard.nodes.find(n => n.id === 'run:2').status = 'running'
  const paths = []
  const stub = { get: async p => { paths.push(p); if (p === '/board.json') return board; if (p === '/card/' + fixture.card_id + '.json') return liveCard; if (p === '/card/t_need0001.json') return { ...fixture, card_id: 't_need0001' }; throw new Error('no ' + p) }, post: async () => ({}) }
  const nav = []
  const link = id => '/crew?card=' + id
  const pane = () => React.createElement(FlowPane, { api: stub, navigate: p => nav.push(p), cardLink: link, boardLink: '/crew' })
  m = await mount(pane)
  await wait(30)
  const sel = m.host.querySelector('select.fsel')
  ok(sel && sel.options.length === 2, 'two cards (running + Needs you): a selector, not a fixed head')
  eq(sel.value, fixture.card_id, 'the running card is shown first')
  const nodes = () => [...m.host.querySelectorAll('.fchart .fnode')]
  const want = fixture.nodes.filter(n => n.kind !== 'session' && n.kind !== 'subagent')
  eq(nodes().length, want.length, 'one box per graph node, the session nodes left out')
  eq(nodes().length > 0 && m.host.querySelectorAll('.fchart .fline').length, nodes().length - 1, 'a connector between each pair of boxes')
  eq(m.host.querySelectorAll('.fchart .fline path.edge:not(.flow)[marker-end]').length, nodes().length - 1, 'every connector ends in an arrowhead')
  ok(m.host.querySelectorAll('.fchart marker path.ah.live').length === 1 && m.host.querySelectorAll('.fchart marker path.ah:not(.live)').length === 1, 'the card page arrow markers, grey and live, are defined')
  ok(nodes().every(e => e.classList.contains('node') && e.querySelector('.card .hdr .glyph') && e.querySelector('.card .foot .chip-tone')), 'each box is the card page node box (.node > .card > .hdr/.foot)')
  ok(nodes()[0].textContent.includes('Owner brief') && nodes()[0].textContent.includes('owner'), 'the owner brief is the first box')
  ok(nodes().at(-1).textContent.includes('Close'), 'close is the last box')
  ok(nodes().some(e => e.textContent.includes('verifier') && e.textContent.includes('failed') && e.classList.contains('st-failed')), 'a failed verifier shows failed')
  const litN = m.host.querySelectorAll('.fnode.on')
  eq([litN.length, litN[0].dataset.id, litN[0].textContent.includes('running')], [1, 'run:2', true], 'only the running node is highlighted')
  eq(m.host.querySelectorAll('.fnode.alive').length, 1, 'the running node carries the card page animated border class (.alive)')
  const flows = m.host.querySelectorAll('.fchart .fline path.edge.flow')
  eq(flows.length, 1, 'exactly one connector carries the flow animation (.edge.flow)')
  eq(m.host.querySelectorAll('.fchart .fline .edge-dot animateMotion').length, 1, 'with the travelling dot')
  const litIdx = [...m.host.querySelectorAll('.fchart .fstepwrap')].findIndex(w => w.querySelector('.edge.flow'))
  eq(nodes()[litIdx].dataset.id, 'run:2', 'and that connector points into the running node')
  const ys = nodes().map(e => e.dataset.id)
  ok(ys.indexOf('brief:t_d3c396cd') < ys.indexOf('card:t_d3c396cd') && ys.indexOf('card:t_d3c396cd') < ys.indexOf('run:2') && ys.indexOf('run:2') < ys.indexOf('verify:t_d3c396cd'), 'top-to-bottom order: brief, coordinator, run, verifier')
  ok(!m.host.querySelector('canvas') && !m.host.querySelector('.minimap') && !m.host.querySelector('.stage') && !m.host.querySelector('.zoomlbl'), 'no minimap, no pan or zoom surface')
  await click(m.host.querySelector('.fnode[data-id="run:2"]'))
  eq(nav, [link(fixture.card_id)], 'a click on a node opens that card route')
  await click(m.host.querySelector('.fchart'))
  eq(nav.at(-1), link(fixture.card_id), 'a click on the chart opens it too')
  await React.act(async () => { sel.value = 't_need0001'; sel.dispatchEvent(new window.Event('change', { bubbles: true })) })
  await wait(30)
  await click(m.host.querySelector('.fchart'))
  eq(nav.at(-1), link('t_need0001'), 'the selector switches the chart to the chosen card')
  // --- the hint, and the pane stepping aside while the card page is open (no public SDK verb collapses a pane, so the
  // pane swaps the chart for one compact line, and restores it when the card page closes)
  const hint = () => m.host.querySelector('.fhint:not(.fcompact)')
  ok(hint() && hint().textContent.trim() === 'Ctrl+J hides this pane' && hint().querySelector('kbd'), 'the pane opens with the quiet "Ctrl+J hides this pane" hint (Ctrl+J as a kbd)')
  ok(m.host.querySelector('.fchart') && !m.host.querySelector('.fcompact'), 'card page closed: the chart shows, no compact line')
  await React.act(async () => { setCardPageOpen(true) })
  ok(!m.host.querySelector('.fchart') && !m.host.querySelector('select.fsel'), 'card page open: the pane shows no chart')
  eq(m.host.querySelector('.fcompact')?.textContent, 'Full flow is open on the left - Ctrl+J hides this pane', 'card page open: the one compact line')
  await React.act(async () => { setCardPageOpen(false) })
  ok(m.host.querySelector('.fchart') && !m.host.querySelector('.fcompact') && hint(), 'card page closed again: the chart and the hint are back')
  eq(cardPageOpen(), false, 'the flag is off after leaving the card page')
  const crewPageSrc = fs.readFileSync(path.join(ui, 'src/components/CrewPage.tsx'), 'utf8')
  ok(/setCardPageOpen\(card\)[^\n]*setCardPageOpen\(false\)/.test(crewPageSrc), 'CrewPage sets the flag from its card route and clears it on unmount')
  board = { ...board, lanes: [{ key: 'done', label: 'Done', hidden: 0, tiles: [tile('t_other1', 'The other card', null)] }] }
  await wait(2300)
  ok(m.host.textContent.includes('Nothing running') && !m.host.querySelector('.fchart'), 'nothing running: the quiet line, no chart')
  await click(m.host.querySelector('.fboard'))
  eq(nav.at(-1), '/crew', 'and its link opens the board')
  await m.done()
}
