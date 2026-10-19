import { useEffect, useRef, useState } from 'react'
import { CW, type Cam, type GraphNode, type Pos } from '../graph-types'

interface Props {
  nodes: GraphNode[]
  pos: Record<string, Pos>
  world: { w: number; h: number }
  cam: Cam
  stage: { w: number; h: number }
  focusRole: string | null
  roleColor: (n: GraphNode) => string
  onCenter: (wx: number, wy: number) => void
}

// A canvas cannot read var(--token): let the browser resolve any CSS colour (token, hex, colour-mix) through the
// canvas element itself, which sits inside the scope that defines the tokens.
function resolveColour(el: HTMLElement, v: string): string {
  el.style.color = v
  return getComputedStyle(el).color
}

// Port of card.js drawMinimap plus its click handler. The canvas keeps its width/height attributes equal to its CSS box
// (a ResizeObserver follows it; offsetWidth, the border box, is what the old fixed 200x130 canvas was), so a pane can size it with CSS alone.
export function Minimap({ nodes, pos, world, cam, stage, focusRole, roleColor, onCenter }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const map = useRef<{ sc: number; ox: number; oy: number } | null>(null)
  const [size, setSize] = useState({ w: 200, h: 130 })

  useEffect(() => {
    const c = ref.current
    if (!c || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = Math.round(c.offsetWidth), h = Math.round(c.offsetHeight)
      if (w > 0 && h > 0) setSize(s => (s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = ref.current
    const ctx = c && c.getContext ? c.getContext('2d') : null
    if (!c || !ctx) return // jsdom has no 2d context; the element and its attributes are still there
    const W = c.width, H = c.height
    ctx.clearRect(0, 0, W, H)
    const sc = Math.min((W - 12) / world.w, (H - 12) / world.h)
    const ox = (W - world.w * sc) / 2, oy = (H - world.h * sc) / 2
    map.current = { sc, ox, oy }
    for (const n of nodes) {
      const it = pos[n.id]
      if (!it) continue
      ctx.globalAlpha = focusRole && n.role !== focusRole ? 0.25 : 1
      ctx.fillStyle = resolveColour(c, roleColor(n))
      ctx.fillRect(ox + it.x * sc, oy + it.y * sc, Math.max(4, CW * sc), Math.max(3, it.cardH * sc))
    }
    ctx.globalAlpha = 1
    const vx = -cam.tx / cam.k, vy = -cam.ty / cam.k, vw = stage.w / cam.k, vh = stage.h / cam.k
    ctx.strokeStyle = resolveColour(c, 'var(--crew-text-1)')
    ctx.lineWidth = 1
    ctx.strokeRect(ox + vx * sc + 0.5, oy + vy * sc + 0.5, vw * sc, vh * sc)
  }, [nodes, pos, world, cam, stage, focusRole, roleColor, size])

  return (
    <canvas
      className="minimap"
      ref={ref}
      width={size.w}
      height={size.h}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation() // the stage closes the selection on a click; a minimap jump is not that click
        const m = map.current
        const c = ref.current
        if (!m || !c) return
        const r = c.getBoundingClientRect()
        onCenter((e.clientX - r.left - m.ox) / m.sc, (e.clientY - r.top - m.oy) / m.sc)
      }}
    />
  )
}
