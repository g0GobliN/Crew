// Card-page host checks (ui/src/host.ts), called by desktop_plugin_harness.mjs: the Desktop button bar and the markdown
// renderer the host provides, against two plugin.js builds that differ only in their stub SDK: one exports the app's
// MessageTextContent / Button / ConfirmDialog, the other none (the browser's situation: no bar, plain text).
// The card is the live fixture t_c9e643de with the state words each case needs (blocked, running, a proof waiting).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function actionChecks({ tmp, React, createRoot, window, document, ok, eq, fixtures, board, makePlugin }) {
  const fx = JSON.parse(fs.readFileSync(path.join(fixtures, 'card.live.json'), 'utf8'))
  const variant = (card_status, headline, live_run, extra = {}) => {
    const c = JSON.parse(JSON.stringify(fx))
    c.card_status = card_status
    c.coordinator = 'default/20261018_abcdef'
    c.situation = { ...c.situation, headline, live_run, proof_ask: '', ...extra }
    const sess = c.nodes.find(n => n.kind === 'session')
    sess.text[0].text = 'Wrote **hello3.txt** with `crew tools live` - a - b'
    sess.text[0].raw = 'Wrote **hello3.txt** with `crew tools live`\n\n- a\n- b\n\n```\nls\n```' // newlines kept (crew_graph._say_raw)
    return c
  }
  const blocked = variant('blocked', 'stopped - needs you', null)
  const running = variant('running', 'working: run 5 on w', { id: 5, profile: 'w' })
  const proof = variant('blocked', 'stopped - needs you', null, { proof_ask: 'blocked' })
  const wait = ms => React.act(async () => { await new Promise(r => setTimeout(r, ms)) })
  const click = el => React.act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) })

  async function openCard(plugin, card, rests) {
    const ctx = {
      registerMany: cs => { plugin.page = cs[0] },
      rest: async (p, o) => {
        rests.push({ path: p, method: o && o.method, body: o && o.body })
        if (p.startsWith('/card/')) return card
        if (p.startsWith('/action/')) return { ok: true, text: 'did ' + p }
        return board
      }
    }
    plugin.mod.default.register(ctx)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await React.act(async () => { root.render(plugin.page.render()) })
    await wait(10)
    await click(host.querySelector('a.card[data-id="t_live77"]'))
    await wait(10)
    return { host, done: async () => { await React.act(async () => { root.unmount() }); host.remove() } }
  }
  // a button that is not drawn has no state: Proof appears only while the card has a proof question
  const state = h => Object.fromEntries(['unstuck', 'retry', 'proof', 'stop'].filter(n => h.querySelector('#act-' + n)).map(n => [n, !h.querySelector('#act-' + n).disabled]))

  const withHost = await makePlugin(true), noHost = await makePlugin(false)
  const opened = globalThis.__opened = []

  // blocked card without a proof question: Unstuck and Retry on, Stop off, no Proof button at all; Open chat there because the card has a session
  let rests = []
  let m = await openCard(withHost, blocked, rests)
  eq([...m.host.querySelectorAll('#actionbar button')].map(b => b.textContent), ['Unstuck', 'Retry', 'Stop', 'Open chat'], 'no proof question: the bar has no Proof button')
  ok(!m.host.querySelector('#act-proof'), 'no #act-proof without a proof question')
  eq(state(m.host), { unstuck: true, retry: true, stop: false }, 'blocked card: button states')
  ok(m.host.querySelector('#act-stop').dataset.variant === 'destructive', 'Stop is the destructive Button variant')
  ok(!m.host.querySelector('#cardCoOpen'), 'the bar replaces the old open-chat chip')
  await click(m.host.querySelector('#act-chat'))
  eq(opened, [['20261018_abcdef', { profile: 'default' }]], 'Open chat opens the coordinator session')
  // Unstuck posts /action/unstuck with the card id, shows the answer, polls again
  const polls = rests.filter(r => r.path.startsWith('/card/')).length
  await click(m.host.querySelector('#act-unstuck'))
  await wait(10)
  eq(rests.filter(r => r.method === 'POST').map(r => [r.path, r.body]), [['/action/unstuck', { card: 't_c9e643de' }]], 'Unstuck posts the card id')
  eq(m.host.querySelector('#actionmsg').textContent, 'did /action/unstuck', 'the answer shows under the bar')
  ok(rests.filter(r => r.path.startsWith('/card/')).length > polls, 'the page polled again after the action')
  // the transcript goes through the host's markdown renderer
  await click(m.host.querySelector('.node[data-id="' + blocked.nodes.find(n => n.kind === 'session').id + '"] .card'))
  const tab = m.host.querySelector('#panel [data-tab="Transcript"]')
  if (tab) await click(tab)
  const md = [...m.host.querySelectorAll('#panel .msg .md .stub-md')]
  ok(md.length > 0 && md.some(e => e.querySelector('strong') && e.querySelector('strong').textContent === 'hello3.txt'), 'a marked message went through renderMarkdown')
  ok(!m.host.querySelector('#panel .msg p'), 'no plain <p> where the host renders')
  ok(md.some(e => e.textContent.includes('\n- a\n- b\n')), 'renderMarkdown received the raw string: the list and the fence arrive on their own lines')
  await m.done()

  // running card: only Stop is on, and it asks first
  rests = []
  m = await openCard(withHost, running, rests)
  eq(state(m.host), { unstuck: false, retry: false, stop: true }, 'running card: button states (no Proof)')
  await click(m.host.querySelector('#act-stop'))
  ok(m.host.querySelector('#confirm'), 'Stop opens the confirm dialog')
  eq(rests.filter(r => r.method === 'POST').length, 0, 'nothing is posted before the answer')
  await click(m.host.querySelector('#confirm-no'))
  await wait(10)
  eq(rests.filter(r => r.method === 'POST').length, 0, 'Cancel posts nothing')
  await click(m.host.querySelector('#act-stop'))
  await click(m.host.querySelector('#confirm-yes'))
  await wait(10)
  eq(rests.filter(r => r.method === 'POST').map(r => [r.path, r.body]), [['/action/stop', { confirm: true, card: 't_c9e643de' }]], 'Stop posts confirm true only after a yes')
  await m.done()

  // a proof question waiting: Proof is on, brave behind a confirm
  rests = []
  m = await openCard(withHost, proof, rests)
  eq([...m.host.querySelectorAll('#actionbar button')].map(b => b.textContent), ['Unstuck', 'Retry', 'Proof', 'Stop', 'Open chat'], 'a proof question: Proof appears')
  eq(state(m.host), { unstuck: true, retry: true, proof: true, stop: false }, 'proof waiting: button states, Proof enabled')
  await click(m.host.querySelector('#act-proof'))
  await click(m.host.querySelector('#confirm-yes'))
  await wait(10)
  eq(rests.filter(r => r.method === 'POST').map(r => [r.path, r.body]), [['/action/proof', { mode: 'brave', card: 't_c9e643de' }]], 'Proof posts brave after the confirm')
  await m.done()

  // no host (the browser's situation): no bar, plain text
  rests = []
  m = await openCard(noHost, blocked, rests)
  ok(!m.host.querySelector('#actionbar'), 'without a host there is no bar')
  ok(m.host.querySelector('#cardCoOpen'), 'without actions the old open-chat chip stays')
  await click(m.host.querySelector('.node[data-id="' + blocked.nodes.find(n => n.kind === 'session').id + '"] .card'))
  const tab2 = m.host.querySelector('#panel [data-tab="Transcript"]')
  if (tab2) await click(tab2)
  const msgs = [...m.host.querySelectorAll('#panel .msg p')]
  ok(msgs.length > 0 && msgs.some(p => p.querySelector('code') && p.textContent.includes('**hello3.txt**')), 'plain text with `code` spans, markers left as written')
  ok(!m.host.querySelector('#panel .msg .md'), 'no host renderer element without a host')
  await m.done()
  fs.rmSync(path.join(tmp, 'nohost'), { recursive: true, force: true })
}
