import { extractSource, MappingError } from './source-map.js'
import { SELECTORS, describeSelection, matchHistory, projectMessage, projectMessageParts, selectedTokenSpan, unitIntersects } from './dom-adapter.js'
import { captureScope, sameScope, scopeOwnsSurface, createHistoryCache } from './history.js'
import { createRawDialog } from './raw-dialog.js'

export function startController(host, ctx, { doc = document, win = window } = {}) {
  const cache = createHistoryCache(host)
  const dialog = createRawDialog(doc, ctx)
  let disposed = false
  let enabled = ctx.storage?.get('enabled', true) !== false
  let scope = captureScope(host)
  let debounce = null
  let preparation = 0
  const unsubscribers = []
  function notify(kind, message) { if (!disposed) host.notify({ kind, message }) }
  function clearPreparation() { preparation++ }
  async function warm(target) {
    if (!target || disposed || !enabled) return
    try { await cache.load(target) } catch { /* On copy, explain and offer raw view. */ }
  }
  function refreshScope() {
    const next = captureScope(host)
    if (!sameScope(scope, next)) { cache.clear(); scope = next; clearPreparation(); dialog.close() }
    void warm(next)
  }
  function queuePreparation() {
    clearPreparation()
    debounce?.()
    debounce = ctx.setTimeout(() => { debounce = null; void prepare() }, 80)
  }
  function materialize(selection, target, rows) {
    if (selection.error) throw new MappingError(selection.error)
    if (!scopeOwnsSurface(host, target, selection.surface)) throw new MappingError('选区的会话归属尚未确认')
    if (selection.selected.some(p => p.root.querySelector('[data-message-streaming="true"]'))) throw new MappingError('消息仍在生成，请完成后再复制')
    const hasSource = projection => rows.some(row => row.role === projection.role && row.model?.signature === projection.signature)
    const projections = [...selection.surface.querySelectorAll(SELECTORS.message)].flatMap(root => {
      try {
        const projection = projectMessage(root)
        return hasSource(projection) ? [projection] : projectMessageParts(root, projection)
      } catch { return [] }
    })
    const visible = projections.filter(hasSource)
    const matched = matchHistory(visible, rows)
    const selectedRows = []
    const selected = projections.filter(p => selection.selected.some(s => s.root === p.root) &&
      p.tokens.some(t => t.members.some(unit => unitIntersects(selection.range, unit))))
    if (!selected.length) throw new MappingError('消息与原文无法唯一匹配')
    const pieces = selected.map(projection => {
      const index = visible.indexOf(projection)
      const row = matched[index]
      if (!row?.model) throw new MappingError('消息与原文无法唯一匹配')
      selectedRows.push(row)
      return extractSource(row.model, ...selectedTokenSpan(projection, selection.range))
    })
    return { text: pieces.join('\n\n'), selectedRows }
  }
  async function prepare() {
    if (!enabled || disposed) return
    const selection = describeSelection(doc)
    const target = captureScope(host)
    if (!selection || !target) return
    const request = ++preparation
    try {
      const rows = await cache.load(target)
      if (disposed || request !== preparation || !sameScope(target, captureScope(host)) || !rows) return
      const current = describeSelection(doc)
      if (!current) return
      materialize(current, target, rows)
    } catch { /* Preserve the selection; copy will show the raw fallback. */ }
  }
  function fallback(reason, target, selectedRows = []) {
    notify('info', `${reason}；本次未复制，已打开源码窗口。`)
    void dialog.open({ reason, scope: target, selectedRows, load: async () => {
      if (!target) throw new Error('没有已确认归属的活动会话')
      return await cache.load(target)
    } })
  }
  function onCopy(event) {
    if (disposed || !enabled || event.defaultPrevented) return
    let selection
    try { selection = describeSelection(doc) } catch { return }
    if (!selection) return
    // Run before document-level native colour guard. Never async-write a copy
    // result after this event: the user's next clipboard action could race it.
    event.preventDefault(); event.stopImmediatePropagation()
    const target = captureScope(host)
    try {
      if (!target) throw new MappingError('会话原文暂不可用')
      if (!event.clipboardData) throw new MappingError('当前复制事件没有可写剪贴板')
      const rows = cache.get(target)
      if (!rows) throw new MappingError('原文尚未就绪')
      // Revalidate live DOM and selection on every copy, even after warmup.
      const result = materialize(selection, target, rows)
      event.clipboardData.clearData()
      event.clipboardData.setData('text/plain', result.text)
      notify('success', '已复制原始 Markdown / LaTeX')
    } catch (error) {
      fallback(error.message || '选区无法准确定位', target)
    }
  }
  ctx.addEventListener(win, 'copy', onCopy, { capture: true })
  ctx.addEventListener(doc, 'selectionchange', queuePreparation)
  ctx.addEventListener(doc, 'pointerup', queuePreparation)
  for (const name of ['focusedSessionId', 'focusedStoredSessionId', 'focusedSessionOwner', 'gateway']) {
    const atom = host.state[name]
    const subscribe = atom?.listen || atom?.subscribe
    if (subscribe) unsubscribers.push(subscribe.call(atom, refreshScope))
  }
  for (const type of ['message.start', 'message.delta', 'message.interim', 'message.complete', 'session.resumed', 'session.reset', 'session.undo', 'session.compacted']) {
    ctx.onEvent(type, event => {
      if (!enabled || disposed) return
      const current = captureScope(host)
      const eventSession = event.session_id ?? event.payload?.session_id
      if (eventSession && current && eventSession !== current.runtimeId && eventSession !== current.storedId) return
      cache.invalidate(current); clearPreparation()
      if (!['message.start', 'message.delta'].includes(type)) void warm(current)
    })
  }
  const commands = {
    toggle() {
      enabled = !enabled
      ctx.storage?.set('enabled', enabled)
      cache.clear(); clearPreparation(); dialog.close()
      notify('info', enabled ? '聊天源码复制已开启' : '聊天源码复制已暂停，恢复普通复制')
      if (enabled) refreshScope()
    },
    openRaw() {
      const target = captureScope(host)
      fallback('请在原文窗口选择需要的片段', target)
    }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true; clearPreparation(); debounce?.()
    unsubscribers.forEach(unsubscribe => unsubscribe())
    cache.dispose(); dialog.close()
  }
  ctx.onDispose(dispose)
  refreshScope()
  return { commands, dispose, prepare, cache, get enabled() { return enabled } }
}
