import { parseSource } from './source-map.js'

export function captureScope(host) {
  const runtimeId = host.state.focusedSessionId?.get()
  const storedId = host.state.focusedStoredSessionId?.get()
  const owner = host.state.focusedSessionOwner?.get()
  if (!runtimeId || !storedId || !owner?.connectionId || !owner?.profile) return null
  const scope = { runtimeId, storedId, connectionId: owner.connectionId, profile: owner.profile }
  return { ...scope, key: JSON.stringify([scope.connectionId, scope.profile, scope.storedId, scope.runtimeId]) }
}

export function sameScope(a, b) { return Boolean(a && b && a.key === b.key) }

export function scopeOwnsSurface(host, scope, surface) {
  if (!sameScope(scope, captureScope(host))) return false
  const target = surface?.getAttribute('data-composer-target')
  return (target === 'main' && host.state.activeSessionId?.get() === scope.runtimeId) || target === scope.runtimeId || target === scope.storedId ||
    target === `tile:${scope.runtimeId}` || target === `tile:${scope.storedId}`
}

export function makeHistory(reply) {
  if (!reply || !Array.isArray(reply.messages)) throw new Error('会话原文接口返回了未知结构')
  let remaining = 1_000_000
  return reply.messages.filter(row => ['assistant', 'user'].includes(row.role) && typeof row.text === 'string' && row.display_kind !== 'hidden').map(row => {
    let model = null
    if (row.text.length <= remaining) {
      remaining -= row.text.length
      try { model = parseSource(row.text, row.role) } catch { /* Raw view remains available. */ }
    }
    // Do not retain reasoning, tool payloads, or backend metadata.
    return { role: row.role, text: row.text, timestamp: row.timestamp, model }
  })
}

function bodyRow(row) {
  if (!row || !['assistant', 'user'].includes(row.role) || row.display_kind === 'hidden') return null
  const text = typeof row.text === 'string' ? row.text : typeof row.content === 'string' ? row.content : null
  if (text === null) return null
  return { role: row.role, text, timestamp: row.timestamp, row_id: row.row_id ?? row.id }
}

async function readStoredHistory(scope, read, current) {
  const rows = []
  const limit = 500
  let characters = 0
  for (let offset = 0; offset < 10000; offset += limit) {
    if (!current()) return null
    const query = new URLSearchParams({ profile: scope.profile, limit: String(limit), offset: String(offset), order: 'oldest', include_compacted: 'true', inline_images: 'false' })
    const page = await read({ connectionId: scope.connectionId, profile: scope.profile,
      path: `/api/sessions/${encodeURIComponent(scope.storedId)}/messages?${query}`, method: 'GET', timeoutMs: 15000 })
    if (!current()) return null
    if (page.profile && page.profile !== scope.profile) throw new Error('会话原文的配置归属无法核对')
    if (page.pagination && (page.pagination.order !== 'oldest' || page.pagination.offset !== offset)) throw new Error('会话原文分页顺序无法核对')
    if (page.pagination?.limit != null && page.pagination.limit !== limit) throw new Error('会话原文分页大小无法核对')
    const messages = Array.isArray(page.messages) ? page.messages : page.data
    if (!Array.isArray(messages)) throw new Error('会话存档接口返回了未知结构')
    if (!messages.length) return rows
    // Use the raw page offset, not projected row count: composite/hidden rows
    // can be deduplicated by the endpoint. Always probe the next raw page.
    for (const message of messages) {
      const row = bodyRow(message)
      if (!row) continue
      rows.push(row); characters += row.text.length
    }
    // Pre-pagination gateways return the entire transcript without metadata.
    // Do not read their same full response repeatedly as different pages.
    if (!page.pagination || characters >= 1000000) return rows
  }
  return rows
}

// The persisted display transcript includes compacted turns; RPC history can
// contain a not-yet-persisted live tail. Append only after one proven shared
// durable row (or a unique exact body when old gateways omit ids).
function combineHistory(stored, live) {
  if (!stored?.length) return live
  const latest = live.map(bodyRow).filter(Boolean)
  for (let index = latest.length - 1; index >= 0; index--) {
    const row = latest[index]
    const candidates = stored.flatMap((candidate, at) => {
      if (candidate.role !== row.role || candidate.text !== row.text) return []
      if (row.row_id != null && candidate.row_id != null && String(row.row_id) !== String(candidate.row_id)) return []
      return [at]
    })
    // Never append after an earlier anchor when a later body is duplicated.
    if (candidates.length > 1) return stored
    if (candidates.length === 1) {
      if (candidates[0] !== stored.length - 1 && index !== latest.length - 1) return stored
      return [...stored, ...latest.slice(index + 1)]
    }
  }
  return stored
}

export function createHistoryCache(host, { maxEntries = 1, readPersisted } = {}) {
  const entries = new Map()
  let disposed = false
  function clear() {
    for (const state of entries.values()) { state.revision++; state.rows = null }
    entries.clear()
  }
  function entry(scope) {
    let state = entries.get(scope.key)
    if (!state) {
      state = { scope, rows: null, dirty: true, pending: null, revision: 0 }
      entries.set(scope.key, state)
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        entries.get(oldest).revision++
        entries.delete(oldest)
      }
    } else { entries.delete(scope.key); entries.set(scope.key, state) }
    return state
  }
  return {
    clear,
    get(scope) { const state = entries.get(scope.key); return state && !state.dirty ? state.rows : null },
    invalidate(scope) {
      if (!scope) return
      const state = entry(scope)
      state.dirty = true; state.revision++
    },
    async load(scope) {
      if (disposed) return null
      const state = entry(scope)
      if (state.pending) return state.pending
      if (!state.dirty && state.rows) return state.rows
      const revision = state.revision
      state.pending = (async () => {
        const route = { connectionId: scope.connectionId, profile: scope.profile, targetProfile: scope.profile, mode: scope.connectionId === 'local' ? 'local' : 'remote' }
        const current = () => !disposed && revision === state.revision
        const [live, stored] = await Promise.allSettled([
          host.requestProfile(route, 'session.history', { session_id: scope.runtimeId, profile: scope.profile }, 15_000),
          readPersisted ? readStoredHistory(scope, readPersisted, current) : Promise.resolve(null)
        ])
        if (!current()) return null
        const liveRows = live.status === 'fulfilled' && Array.isArray(live.value?.messages) ? live.value.messages : null
        const storedRows = stored.status === 'fulfilled' ? stored.value : null
        if (!liveRows && !storedRows) throw new Error('会话原文暂不可用')
        state.rows = makeHistory({ messages: combineHistory(storedRows, liveRows || []) }); state.dirty = false
        return state.rows
      })().finally(() => { state.pending = null })
      return state.pending
    },
    dispose() { disposed = true; clear() }
  }
}
