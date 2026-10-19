import type { Board } from './types'

// The Needs-you popup (Desktop only). Hermes Desktop's own "blocked" toast comes from its Kanban plugin, on that plugin's
// own events socket, and its button opens /kanban: the SDK has no door to change or hear it. So Crew watches its own
// board and, when a card newly lands in Needs you as blocked, shows its own toast whose button opens the card in Crew.
// The first read only sets the baseline (cards already blocked at start are not news); a failed read changes nothing.
export interface BlockedToast {
  id: string
  title: string
  message: string
  detail: string
}

export function blockedWatch(read: () => Promise<Board>, onBlocked: (t: BlockedToast) => void): () => Promise<void> {
  let seen: Set<string> | null = null
  return async () => {
    let board: Board
    try { board = await read() } catch { return }
    if (board.error) return   // the server said it has no board: that is not "nothing is blocked"
    const now = new Map<string, string>()
    for (const lane of board.lanes || [])
      if (lane.key === 'blocked')
        for (const t of lane.tiles) if (t.status === 'blocked') now.set(t.id, t.title)
    const before = seen
    seen = new Set(now.keys())
    if (!before) return
    for (const [id, title] of now) if (!before.has(id)) onBlocked({ id, title, message: title || id, detail: id })
  }
}
