// Needs-you popup checks (ui/src/blocked-watch.ts, desktop.tsx watchBlocked, CrewPage's card link), called by
// desktop_plugin_harness.mjs. Stub ctx: a fake setInterval the test ticks by hand, rest answering a board the test edits,
// os.notify recorded. The stub SDK's host records toasts and sets the location hash on navigate, like the real one.
export async function blockedChecks({ React, createRoot, window, document, ok, eq, board, makePlugin }) {
  const tile = (id, status, title) => ({ id, title, status, role: 'worker', assignee: 'w', active: null, runs: 1, age_s: 60, settled_s: null, summary: '', verdict: null, proof_ask: '' })
  const lane = (key, tiles) => ({ key, label: key, hidden: 0, tiles })
  let state = { blocked: [tile('t_old', 'blocked', 'Already stuck')], queued: [tile('t_rdy', 'ready', 'Waiting')] }
  const current = () => ({ ...board, lanes: [lane('blocked', state.blocked), lane('queued', state.queued)], cards: 3 })
  const wait = ms => React.act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const click = el => React.act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  const withHost = await makePlugin(true), noHost = await makePlugin(false)

  const boot = async plugin => {
    const timers = [], os = [], rest = { fail: false, calls: 0 }
    const ctx = {
      registerMany: cs => { plugin.page = cs[0] },
      setInterval: (fn, ms) => { timers.push({ fn, ms }); return () => {} },
      os: { notify: n => os.push(n) },
      rest: async () => { rest.calls++; if (rest.fail) throw new Error('boom'); return current() }
    }
    plugin.mod.default.register(ctx)
    await wait(10)
    const tick = async () => { await React.act(async () => { timers.forEach(t => t.fn()); await new Promise(r => setTimeout(r, 10)) }) }
    return { timers, os, rest, tick }
  }

  globalThis.__toasts = []
  window.location.hash = ''
  let w = await boot(withHost)
  eq(w.timers.map(t => t.ms), [5000], 'one poll timer, every 5 s')
  eq(globalThis.__toasts, [], 'a card already blocked at start is the baseline, not news')
  await w.tick()
  eq(globalThis.__toasts, [], 'nothing new on the next poll: no toast')

  // a card newly blocked: one toast with the title and the Open in Crew action, one OS notification
  state = { ...state, blocked: [...state.blocked, tile('t_new1', 'blocked', 'Port the board')] }
  await w.tick()
  eq(globalThis.__toasts.length, 1, 'a newly blocked card raises one toast')
  const toast = globalThis.__toasts[0]
  eq([toast.id, toast.kind, toast.message, toast.detail, toast.action.label], ['crew-blocked-t_new1', 'warning', 'Port the board', 't_new1', 'Open in Crew'], 'the toast names the card and carries Open in Crew')
  eq(w.os.map(n => n.body), ['Port the board\nt_new1'], 'the OS notification carries the card title and id')
  await w.tick()
  eq(globalThis.__toasts.length, 1, 'a card that stays blocked toasts once')
  // a triage card in the same lane is not a block; a failed read and an error board change nothing
  state = { ...state, blocked: [...state.blocked, tile('t_tri', 'triage', 'Sorting')] }
  await w.tick()
  eq(globalThis.__toasts.length, 1, 'a triage card in Needs you is not a block')
  w.rest.fail = true
  await w.tick()
  w.rest.fail = false
  await w.tick()
  eq(globalThis.__toasts.length, 1, 'a failed poll neither toasts nor forgets the baseline')
  // unblocked and blocked again: news again
  state = { ...state, blocked: state.blocked.filter(t => t.id !== 't_new1') }
  await w.tick()
  state = { ...state, blocked: [...state.blocked, tile('t_new1', 'blocked', 'Port the board')] }
  await w.tick()
  eq(globalThis.__toasts.length, 2, 'a card blocked again toasts again')

  // the action navigates to the Crew route with the card, and the mounted page opens that card
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const rests = []
  const pageCtx = { registerMany: cs => { w.page = cs[0] }, rest: async p => { rests.push(p); return p.startsWith('/card/') ? { card_id: p.slice(6), card_status: 'blocked', title: 'Port the board', nodes: [], situation: {} } : current() } }
  withHost.mod.default.register(pageCtx)
  await React.act(async () => { root.render(w.page.render()) })
  await wait(10)
  ok(host.querySelector('.page-board'), 'the page starts on the board')
  await React.act(async () => { toast.action.onClick() })
  await wait(40)
  ok(/^#\/crew\?card=t_new1&n=\d+$/.test(window.location.hash), 'the action set the route to /crew with the card id: ' + window.location.hash)
  ok(rests.some(p => p.startsWith('/card/t_new1')), 'the page opened that card (fetched /card/t_new1)')
  // back to the board, then the same link again: a second open works (the stamp changes the hash)
  rests.length = 0
  await React.act(async () => { root.unmount() })
  host.remove()

  // no host SDK (the browser's situation or an older shell): no timer, no poll
  globalThis.__toasts = []
  const nh = await boot(noHost)
  eq([nh.timers.length, nh.rest.calls], [0, 0], 'without host.notify the watcher does not start')
  window.location.hash = ''
}
