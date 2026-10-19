import { faceName } from './avatars'

// One way for the components to reach Crew's JSON routes, whichever shell they run in.
// Desktop: ctx.rest (path relative to /api/plugins/crew, JSON only). Browser: fetch on the page's own origin.
export interface CrewApi {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  // The browser can point an <img> straight at a role's face; Desktop cannot (ctx.rest is JSON-only), so it leaves this
  // undefined and avatars.ts fetches a data URL instead.
  avatarUrl?(name: string): string
}

// What POST /ack/<id> (or /ack/all, ?undo=1) answers in both shells: the daemon's plain-text reply wrapped like the
// Desktop route /embed/ack/<id> wraps it. A 409 ("only a row on the list is cleared") is an answer, not a failure.
export interface AckResult {
  ok: boolean
  status: number
  text: string
}

export interface RestCtx {
  rest(path: string, opts?: { method?: string; body?: unknown }): Promise<any>
}

export function restApi(ctx: RestCtx): CrewApi {
  return {
    get: path => ctx.rest(path),
    // The components speak the browser's paths; the Desktop plugin API answers acks as JSON under /embed/ack/.
    post: (path, body) => ctx.rest(path.startsWith('/ack/') ? '/embed' + path : path, { method: 'POST', body })
  }
}

// `base` prefixes every path (the Hermes web dashboard tab serves Crew under /api/plugins/crew). `fetchFn` is the
// transport: the tab passes the SDK's authedFetch, which adds the session header a bare fetch would lack. With
// `directFaces` off the faces come as data URLs from /embed/avatar (an <img src> sends no header), like Desktop.
export function fetchApi(base = '', fetchFn: typeof fetch = (...a) => fetch(...a), directFaces = true): CrewApi {
  const ack = async (path: string): Promise<AckResult> => {
    const res = await fetchFn(base + path, { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
    return { ok: res.ok, status: res.status, text: await res.text() }
  }
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetchFn(base + path, { credentials: 'same-origin', ...init })
    if (!res.ok) throw new Error(path + ': HTTP ' + res.status)
    return res.json()
  }
  return {
    get: path => call(path),
    post: (path, body) =>
      path.startsWith('/ack/')
        ? (ack(path) as Promise<any>)
        : call(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
          }),
    ...(directFaces ? { avatarUrl: (name: string) => base + '/avatars/role/' + faceName(name) + '.svg' } : {})
  }
}
