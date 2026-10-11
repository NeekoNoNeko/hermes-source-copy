import { extractSource, MappingError } from './source-map.js'
import { SELECTORS, elementOf, alignProjection, describeSelection, matchHistory, projectMessage, projectMessageParts, selectedTokenSpan, unitIntersects } from './dom-adapter.js'
import { captureScope, sameScope, scopeOwnsSurface, createHistoryCache } from './history.js'
import { createRawDialog } from './raw-dialog.js'

export function startController(host, ctx, { doc = document, win = window } = {}) {
  const cache = createHistoryCache(host, { readPersisted: typeof win.hermesDesktop?.api === 'function' ? request => win.hermesDesktop.api(request) : undefined })
  const dialog = createRawDialog(doc, ctx)
  let disposed = false
  let enabled = ctx.storage?.get('enabled', true) !== false
  let scope = captureScope(host)
  let debounce = null
  let copyGeneration = 0
  const unsubscribers = []
  function notify(kind, message) { if (!disposed) host.notify({ kind, message }) }
  function clearCopyPrompt() { copyGeneration++ }
  async function warm(target) {
    if (!target || disposed || !enabled) return
    try { await cache.load(target) } catch { /* On copy, explain and offer raw view. */ }
  }
  function refreshScope() {
    const next = captureScope(host)
    if (!sameScope(scope, next)) { cache.clear(); scope = next; clearCopyPrompt(); dialog.close() }
    void warm(next)
  }
  function queuePreparation() {
    debounce?.()
    debounce = ctx.setTimeout(() => { debounce = null; void prepare() }, 80)
  }
  function validateSelection(selection, target) {
    if (selection.error) throw new MappingError(selection.error)
    if (!selection.surface.isConnected || selection.selected.some(p => !p.root.isConnected)) throw new MappingError('消息正文已发生变化，请重新选择')
    if (!scopeOwnsSurface(host, target, selection.surface)) throw new MappingError('选区的会话归属尚未确认')
    if (selection.selected.some(p => p.root.querySelector('[data-message-streaming="true"]'))) throw new MappingError('消息仍在生成，请完成后再复制')
  }
  function materialize(selection, target, rows) {
    validateSelection(selection, target)
    const hasSource = projection => rows.some(row => alignProjection(projection, row.model))
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
      return extractSource(row.model, ...selectedTokenSpan(alignProjection(projection, row.model), selection.range))
    })
    return { text: pieces.join('\n\n'), selectedRows }
  }
  async function prepare() {
    if (!enabled || disposed) return
    const target = captureScope(host)
    if (!target || cache.get(target) || !describeSelection(doc)) return
    // Warm only: full DOM/source matching is revalidated by the copy event.
    // Running it again on every selection change needlessly stalls long chats.
    await warm(target)
  }
  function fallback(reason, target, selectedRows = []) {
    notify('info', `${reason}；本次未复制，已打开源码窗口。`)
    void dialog.open({ reason, scope: target, selectedRows, load: async () => {
      if (!target) throw new Error('没有已确认归属的活动会话')
      return await cache.load(target)
    } })
  }
  async function waitForSource(selection, target, request) {
    notify('info', '原文正在加载，本次尚未复制；就绪后请再次按 Ctrl+C。')
    function stillSelected() {
      if (disposed || !enabled || request !== copyGeneration || !sameScope(target, captureScope(host))) return null
      const current = describeSelection(doc), a = selection.range, b = current?.range
      return current?.surface === selection.surface && a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
        a.endContainer === b.endContainer && a.endOffset === b.endOffset ? current : null
    }
    try {
      const rows = await cache.load(target)
      const current = stillSelected()
      if (!rows || !current) return
      materialize(current, target, rows)
      notify('info', '原文已就绪，请再次按 Ctrl+C 复制。')
    } catch (error) {
      if (stillSelected()) fallback(error.message || '会话原文暂不可用', target)
    }
    // Never asynchronously write the clipboard after the user's copy event.
  }
  function onCopy(event) {
    if (disposed || !enabled || event.defaultPrevented) return
    const request = ++copyGeneration
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
      validateSelection(selection, target)
      const rows = cache.get(target)
      if (!rows) {
        if (cache.status(target) === 'error') throw new MappingError('会话原文暂不可用')
        void waitForSource(selection, target, request)
        return
      }
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
  ctx.addEventListener(win, 'blur', clearCopyPrompt)
  ctx.addEventListener(doc, 'focusin', clearCopyPrompt)
  ctx.addEventListener(doc, 'pointerdown', event => {
    clearCopyPrompt()
    if (elementOf(event.target)?.closest(SELECTORS.message)) void warm(captureScope(host))
  })
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
      cache.invalidate(current); clearCopyPrompt()
      if (!['message.start', 'message.delta'].includes(type)) void warm(current)
    })
  }
  const commands = {
    toggle() {
      enabled = !enabled
      ctx.storage?.set('enabled', enabled)
      cache.clear(); clearCopyPrompt(); dialog.close()
      notify('info', enabled ? '聊天源码复制已开启' : '聊天源码复制已暂停，恢复普通复制')
      if (enabled) refreshScope()
    },
    openRaw() {
      clearCopyPrompt()
      const target = captureScope(host)
      fallback('请在原文窗口选择需要的片段', target)
    }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true; clearCopyPrompt(); debounce?.()
    unsubscribers.forEach(unsubscribe => unsubscribe())
    cache.dispose(); dialog.close()
  }
  ctx.onDispose(dispose)
  refreshScope()
  return { commands, dispose, prepare, cache, get enabled() { return enabled } }
}
