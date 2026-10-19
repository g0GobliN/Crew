// The slice of GET /card/<id>.json (scripts/crew_graph.py build_graph, laid out by layout_flow) that the flow graph reads.
// Every other key of the card JSON passes through untouched, so the card page can hand its whole payload to <Graph>.
export interface GraphStep {
  tool: string
  ts?: number
  sec?: number | null
  args?: string
}
export interface GraphToolRun {
  tool: string
  state: string // pending | ok | err
  count?: number
  last_ts?: number
}
export interface GraphNode {
  id: string
  kind: string // card | run | session | verifier | close | brief | subagent
  label: string
  title?: string
  status: string // running | done | blocked | failed | pending
  layer: number // row, set by layout_flow
  x?: number // order within the row, set by layout_flow
  role?: string
  role_color?: string
  run_id?: number | string | null // on a session node: the run it ran
  card?: string // the card this node belongs to (differs from the page card for a child card)
  evidence?: Record<string, any>
  brief?: { text?: string; source?: string }
  tool_count?: number
  last_tool?: string
  last_ts?: number
  t1?: number | null
  tool_runs?: GraphToolRun[]
  tool_run_total?: number
  steps?: GraphStep[]
}
export interface GraphEdge {
  from: string
  to: string
}
export interface GraphRole {
  name: string
  color?: string
}
export interface CardJson {
  card_id: string
  card_title?: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  roles?: GraphRole[]
  [key: string]: unknown
}

export interface Pos {
  x: number
  y: number
  cardH: number
}
export interface Cam {
  k: number
  tx: number
  ty: number
}

export const CW = 250 // node width, the same number the .node rule in graph.css uses
