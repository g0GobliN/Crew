// The shape of GET /board.json (scripts/crew_graph_serve.py board_data). Only the keys the UI reads.
export interface Tile {
  id: string
  title: string
  status: string
  role: string
  assignee: string
  active: { profile: string; run: number; for_s: number; quiet_s?: number | null; steps?: number; last_tool?: string } | null
  color?: string
  runs?: number
  age_s?: number
  settled_s?: number | null
  summary?: string
  verdict?: string | null
  budget?: { used: number; ceiling: number; pct: number }
  test?: boolean
  // the kind of proof question waiting for the owner ("blocked" | "rescope"), "" when none; Desktop's tile buttons read it
  proof_ask?: string
}
export interface Lane {
  key: string
  label: string
  tiles: Tile[]
  hidden: number
}
// One row of the bell's list (board_data attention.rows).
export interface AttentionRow {
  id: string
  status: string
  title: string
  who: string
  age_s: number
  ack_url?: string
}
export interface Attention {
  rows?: AttentionRow[]
  stuck?: number
  done?: number
  total?: number
  ack_all?: string
}
export interface Board {
  lanes: Lane[]
  counts: Record<string, number>
  live?: number
  cards?: number
  error?: string
  node?: string
  attention?: Attention
  // Optional header facts (the header's "<node> - kanban[ <slug>] link"); the browser falls back to its own origin.
  board?: string
  dashboard_url?: string
  // Is the Hermes gateway (it runs the kanban dispatcher) up? Absent from an older server: no strip is drawn.
  dispatcher?: { alive?: boolean; detail?: string; command?: string }
}

// Every live card: the tiles with `active` across the lanes, in board order.
export function liveTiles(board: Board | null): Tile[] {
  const out: Tile[] = []
  for (const lane of board?.lanes ?? []) for (const t of lane.tiles) if (t.active) out.push(t)
  return out
}

// The first live card, or null.
export function liveTile(board: Board | null): Tile | null {
  return liveTiles(board)[0] ?? null
}
