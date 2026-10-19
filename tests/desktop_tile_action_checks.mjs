// Board-tile action checks (ui/src/components/ActionBar.tsx TileActions), called by desktop_plugin_harness.mjs: with the
// host's actions each tile carries a compact Unstuck / Retry row (+ Proof only while a proof question waits) on the cards of the blocked (Needs you) lane only, enabled by the same rules as the card
// page; a click on a row button acts on that tile's card and never opens the card; without the host the tile DOM is
// exactly what the browser board draws. The board is built inline here, so the checks do not depend on fixture edits.

export async function tileActionChecks({ React, createRoot, window, document, ok, eq, board, makePlugin }) {
  const tile = (id, status, extra = {}) => ({
    id, title: 'tile ' + id, status, role: 'worker', assignee: 'w', active: null, runs: 1, age_s: 60,
    settled_s: null, summary: '', verdict: null, proof_ask: '', ...extra
  })
  const lanes = [
    { key: 'blocked', label: 'Blocked', hidden: 0, tiles: [tile('t_blk', 'blocked'), tile('t_prf', 'blocked', { proof_ask: 'blocked' }), tile('t_rsc', 'blocked', { proof_ask: 'rescope' })] },
    { key: 'running', label: 'Running', hidden: 0, tiles: [tile('t_run', 'running', { active: { profile: 'w', run: 5, for_s: 30, quiet_s: 1 } })] },
    { key: 'queued', label: 'Queued', hidden: 0, tiles: [tile('t_rdy', 'ready')] },
    { key: 'review', label: 'Review', hidden: 0, tiles: [tile('t_rev', 'review')] },
    { key: 'done', label: 'Done', hidden: 0, tiles: [tile('t_done', 'done', { verdict: 'PASS' })] },
    { key: 'archived', label: 'Archived', hidden: 0, tiles: [tile('t_arc', 'archived')] }
  ]
  const fx = { ...board, lanes, cards: 8, live: 1 }
  const wait = ms => React.act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const click = el => React.act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) })

  async function mountBoard(plugin, rests) {
    const ctx = {
      registerMany: cs => { plugin.page = cs[0] },
      rest: async (p, o) => {
        rests.push({ path: p, method: o && o.method, body: o && o.body })
        if (p.startsWith('/action/')) return { ok: true, text: 'did ' + p }
        return fx
      }
    }
    plugin.mod.default.register(ctx)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await React.act(async () => { root.render(plugin.page.render()) })
    await wait(10)
    return { host, done: async () => { await React.act(async () => { root.unmount() }); host.remove() } }
  }
  const row = (h, id) => h.querySelector('a.card[data-id="' + id + '"] .tact')
  const state = (h, id) => Object.fromEntries([...row(h, id).querySelectorAll('button')].map(b => [b.textContent, !b.disabled]))
  const btn = (h, id, label) => [...row(h, id).querySelectorAll('button')].find(b => b.textContent === label)
  const posts = rests => rests.filter(r => r.method === 'POST').map(r => [r.path, r.body])

  const withHost = await makePlugin(true), noHost = await makePlugin(false)

  let rests = []
  let m = await mountBoard(withHost, rests)
  eq([...row(m.host, 't_blk').querySelectorAll('button')].map(b => b.textContent), ['Unstuck', 'Retry'], 'a blocked-lane tile without a proof question shows Unstuck and Retry only')
  for (const id of ['t_run', 't_rdy', 't_done', 't_arc', 't_rev']) ok(!m.host.querySelector('a.card[data-id="' + id + '"] .tact'), id + ': no buttons outside the Needs-you lane')
  ok(m.host.querySelector('a.card[data-id="t_run"]') && !m.host.querySelector('a.card[data-id="t_run"] button'), 'Stop is never on a tile')
  ok(row(m.host, 't_blk').querySelector('button').dataset.size === 'xs', 'the tile buttons use the smallest size')
  ok(!m.host.querySelector('a.card button[id]'), 'tile buttons carry no ids (a board has many)')
  eq(state(m.host, 't_blk'), { Unstuck: true, Retry: true }, 'blocked tile: states, no Proof')
  ok(!btn(m.host, 't_blk', 'Proof'), 'a tile without proof_ask has no Proof button at all')
  eq([...row(m.host, 't_prf').querySelectorAll('button')].map(b => b.textContent), ['Unstuck', 'Retry', 'Proof'], 'a tile with proof_ask shows Proof')
  eq(state(m.host, 't_prf'), { Unstuck: true, Retry: true, Proof: true }, 'blocked tile with a proof ask: states')

  // Unstuck: posts that tile's card, shows the answer on the tile, and does not open the card
  const before = rests.length
  let proceeded = true
  await React.act(async () => { proceeded = btn(m.host, 't_blk', 'Unstuck').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  await wait(10)
  eq(posts(rests), [['/action/unstuck', { card: 't_blk' }]], 'Unstuck posts the tile card id')
  eq(m.host.querySelector('a.card[data-id="t_blk"] .tmsg').textContent, 'did /action/unstuck', 'the answer shows on the tile')
  ok(m.host.querySelector('.page-board') && !m.host.querySelector('.page-card'), 'the click did not open the card')
  ok(!rests.slice(before).some(r => r.path.startsWith('/card/')), 'no card was fetched')
  ok(proceeded === false, 'the default navigation of the tile link was prevented')

  // proof brave and rescope (Stop is not on tiles; the card page covers it)
  rests.length = 0
  await click(btn(m.host, 't_prf', 'Proof'))
  await click(m.host.querySelector('#confirm-yes'))
  await wait(10)
  eq(posts(rests), [['/action/proof', { mode: 'brave', card: 't_prf' }]], 'a flagged proof posts brave after the confirm')
  rests.length = 0
  await click(btn(m.host, 't_rsc', 'Proof'))
  await wait(10)
  eq(posts(rests), [['/action/proof', { mode: 'yes', card: 't_rsc' }]], 'a rescope proof posts yes with no confirm')
  // a click on the tile body still opens the card
  await click(m.host.querySelector('a.card[data-id="t_blk"] .ti'))
  await wait(10)
  ok(rests.some(r => r.path.startsWith('/card/')), 'a click on the tile itself still opens the card')
  await m.done()

  // no host: no row, the tile DOM is the browser's
  rests = []
  m = await mountBoard(noHost, rests)
  ok(m.host.querySelectorAll('a.card').length === 7, 'the tiles render without a host')
  ok(!m.host.querySelector('.tact') && !m.host.querySelector('a.card button'), 'without a host there is no action row')
  eq([...m.host.querySelector('a.card[data-id="t_blk"]').children].map(c => c.className), ['ti', 'ft'], 'the tile DOM is title and footer only')
  await m.done()
}
