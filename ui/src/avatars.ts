import { useEffect, useState } from 'react'
import type { CrewApi } from './api'

// A role's face: the dashboard server gives each role one of the shipped DiceBear "Blobs" variants and keeps it
// (crew_graph_serve.role_face); the page only names the role. Same name rules as the old lib.js faceUrl.
export function faceName(name: string): string {
  const n = String(name || '').toLowerCase().replace(/^crew-/, '').replace(/[^a-z0-9_-]/g, '')
  return n || 'unknown'
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const cache = new Map<string, Promise<string>>()   // name -> data URL, fetched once per name in this page

// The image source for a role's face. Browser: the direct URL (api.avatarUrl). Desktop: ctx.rest is JSON-only, so the
// face comes as a data URL from GET /embed/avatar/role/<name>.svg, once per name. '' while it loads or when it fails.
export function useAvatar(api: CrewApi, name: string): string {
  const direct = name && api.avatarUrl ? api.avatarUrl(name) : ''
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!name || direct) return
    const n = faceName(name)
    let hit = cache.get(n)
    if (!hit) {
      hit = api.get<{ data_url?: string }>('/embed/avatar/role/' + n + '.svg').then(r => {
        if (!r || !r.data_url) throw new Error('no data_url for ' + n)
        return r.data_url
      })
      hit.catch(() => cache.delete(n))   // a failed fetch is retried the next time the face is shown
      cache.set(n, hit)
    }
    let live = true
    hit.then(u => { if (live) setUrl(u) }, () => {})
    return () => { live = false }
  }, [api, name, direct])
  return direct || url || BLANK
}
