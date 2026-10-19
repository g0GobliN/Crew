// The shape of GET /card/<id>.json (scripts/crew_graph.py build_graph, served by crew_graph_serve.card_response).
// Only the keys the card page reads; evidence blobs vary per node kind, so they stay loose.
export interface Step {
  tool: string
  args?: string
  sec?: number | null
  ts?: number
  state?: string
  note?: string
  out?: string
  say?: string
}
export interface ToolRun {
  tool: string
  count: number
  last_ts?: number | null
  state: string
}
export interface CardNode {
  id: string
  kind: string
  label: string
  status: string
  role: string
  evidence?: Record<string, any>
  steps?: Step[]
  tool_runs?: ToolRun[]
  tool_run_total?: number
  tool_count?: number
  last_tool?: string | null
  last_ts?: number | null
  t0?: number | null
  t1?: number | null
  prompt?: string
  live?: { state?: string; tool?: string; [k: string]: any }
  // `raw` = the text with its newlines (only when it has any); the host's markdown renderer reads it, `.msg p` reads `text`
  text?: { ts?: number; text: string; raw?: string }[]
  card?: string
  role_color?: string
  layer: number
  x?: number
  title?: string
  brief?: { text?: string; ts?: number | null; source?: string; by?: string; origin?: string }
  run_id?: number | null
  [k: string]: any
}
export interface CardEdge {
  from: string
  to: string
}
export interface CardRole {
  name: string
  color: string
  purpose?: string
  proof?: string
  active?: boolean
  nodes: number
}
export interface RouteRow {
  ts?: number
  kind?: string
  provider?: string
  model?: string
  why?: string
  wall_number?: number | null
}
export interface Situation {
  headline?: string
  why?: string
  reason?: string
  reason_source?: string
  reason_age_s?: number | null
  reason_actor?: string
  repeat?: string
  repeat_text?: string
  repeat_stops?: number
  runs?: number
  counts?: Record<string, number>
  children?: unknown[]
  units?: { total?: number; passed?: number }
  first_pass?: { passes?: number; fails?: number; first_pass?: boolean; rounds?: number }
  live_run?: { id?: number; profile?: string } | null
  proof_ask?: string
}
export interface CardJson {
  generated_at?: number
  card_id: string
  card_title?: string
  card_status?: string
  card_role?: string
  card_model?: string
  card_created_at?: number | null
  coordinator?: string
  tokens?: { ceiling?: number; used?: number; raw_total?: number; calls?: number; pct?: number }
  situation?: Situation
  report?: string
  node_count?: number
  edge_count?: number
  nodes: CardNode[]
  edges: CardEdge[]
  roles?: CardRole[]
  route?: RouteRow[]
  [k: string]: any
}
