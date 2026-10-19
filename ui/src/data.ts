import { useCallback, useEffect, useRef, useState } from 'react'
import type { CrewApi } from './api'
import type { CardJson } from './card-types'
import type { Board } from './types'

// Polls /board.json. A failed poll keeps the last board and sets `error`, so a blip does not blank the page.
// `query` is the flag string appended to the route, e.g. 'all=1&older=1' (no leading '?').
export function useBoard(api: CrewApi, intervalMs = 2000, query = '') {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    const load = () =>
      api
        .get<Board>('/board.json' + (query ? '?' + query : ''))
        .then(b => { if (live) { setBoard(b); setError(null) } })
        .catch(e => { if (live) setError(String((e && e.message) || e)) })
        .finally(() => { if (live) setLoading(false) })
    load()
    const timer = setInterval(load, intervalMs)
    return () => { live = false; clearInterval(timer) }
  }, [api, intervalMs, query, tick])
  // refresh() polls again now (after an ack); it restarts the interval too.
  return { board, error, loading, refresh: () => setTick(n => n + 1) }
}

// Polls /card/<id>.json (the card page's data). A failed poll keeps the last card and sets `error`. `paused` stops
// the timer (the page's space key) and `reload()` fetches once now (its r key). A new id starts empty again.
export function useCard(api: CrewApi, id: string, intervalMs = 2000, paused = false) {
  const [card, setCard] = useState<CardJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loadRef = useRef<() => void>(() => {})
  useEffect(() => {
    let live = true
    setCard(null)
    setLoading(true)
    const load = () =>
      api
        .get<CardJson>('/card/' + encodeURIComponent(id) + '.json')
        .then(c => { if (live) { setCard(c); setError(null) } })
        .catch(e => { if (live) setError(String((e && e.message) || e)) })
        .finally(() => { if (live) setLoading(false) })
    loadRef.current = load
    load()
    if (paused) return () => { live = false }
    const timer = setInterval(load, intervalMs)
    return () => { live = false; clearInterval(timer) }
  }, [api, id, intervalMs, paused])
  const reload = useCallback(() => loadRef.current(), [])
  return { card, error, loading, reload }
}
