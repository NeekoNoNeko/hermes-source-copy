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

export function createHistoryCache(host, { maxEntries = 1 } = {}) {
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
        const reply = await host.requestProfile(route, 'session.history', { session_id: scope.runtimeId, profile: scope.profile }, 15_000)
        if (disposed || revision !== state.revision) return null
        state.rows = makeHistory(reply); state.dirty = false
        return state.rows
      })().finally(() => { state.pending = null })
      return state.pending
    },
    dispose() { disposed = true; clear() }
  }
}
