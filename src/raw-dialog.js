export function createRawDialog(doc, ctx) {
  let overlay = null
  let generation = 0
  let closeDialog = () => {}
  function close() { generation++; closeDialog() }
  return {
    close,
    async open({ reason, scope, load, selectedRows = [] }) {
      close()
      const request = ++generation
      const previousFocus = doc.activeElement
      overlay = doc.createElement('div')
      overlay.setAttribute('data-source-copy-dialog', '')
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;'
      const panel = doc.createElement('section')
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('aria-labelledby', 'hermes-source-copy-title')
      panel.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:min(960px,95vw);height:min(760px,90vh);padding:20px;border-radius:12px;background:var(--ui-chat-surface-background,var(--background,#202020));color:var(--ui-text-primary,var(--foreground,#eee));border:1px solid var(--ui-stroke-tertiary,#777);box-shadow:0 16px 60px #0005;'
      const heading = doc.createElement('h2')
      heading.id = 'hermes-source-copy-title'; heading.textContent = '复制原始 Markdown / LaTeX'
      heading.style.cssText = 'font-size:16px;font-weight:600;margin:0;'
      const note = doc.createElement('p')
      note.textContent = `${reason}。本次尚未复制，请在下面选择原文后按 Ctrl+C。`
      note.style.cssText = 'font-size:13px;margin:0;white-space:pre-wrap;'
      const scopeLabel = doc.createElement('small')
      scopeLabel.textContent = scope ? `${scope.connectionId} / ${scope.profile} / ${scope.storedId}` : '会话归属尚未确认'
      const select = doc.createElement('select')
      select.setAttribute('aria-label', '选择消息')
      const text = doc.createElement('textarea')
      text.readOnly = true; text.spellcheck = false; text.setAttribute('aria-label', '消息原始源码')
      text.style.cssText = 'flex:1;min-height:160px;resize:none;padding:12px;white-space:pre;overflow:auto;font:13px/1.6 ui-monospace,Consolas,monospace;color:inherit;background:var(--ui-control-background,var(--background,#181818));border:1px solid var(--ui-stroke-tertiary,#777);border-radius:6px;'
      const actions = doc.createElement('div')
      actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;'
      const button = (label, run) => {
        const el = doc.createElement('button'); el.type = 'button'; el.textContent = label
        el.style.cssText = 'padding:6px 12px;border:1px solid var(--ui-stroke-tertiary,#777);border-radius:6px;background:var(--ui-control-background,transparent);color:inherit;cursor:pointer;'
        el.addEventListener('click', run); return el
      }
      const all = button('全选原文', () => { text.focus(); text.select() })
      const copy = button('复制整条原文', async () => {
        const value = text.value
        const ok = await ctx.os.writeClipboard(value).catch(() => false)
        if (request !== generation) return
        note.textContent = ok ? '已复制整条原文。' : '剪贴板写入失败，请全选原文后按 Ctrl+C。'
      })
      all.disabled = true; copy.disabled = true
      const dismiss = button('关闭', close)
      actions.append(all, copy, dismiss)
      panel.append(heading, note, scopeLabel, select, text, actions)
      overlay.append(panel); doc.body.append(overlay)
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
        if (event.key === 'Tab') {
          const items = [select, text, all, copy, dismiss].filter(el => !el.disabled)
          const index = items.indexOf(doc.activeElement)
          const next = (index + (event.shiftKey ? -1 : 1) + items.length) % items.length
          event.preventDefault(); items[next].focus()
        }
      }
      overlay.addEventListener('keydown', onKey)
      overlay.addEventListener('mousedown', event => { if (event.target === overlay) close() })
      const currentOverlay = overlay
      closeDialog = () => {
        currentOverlay.remove()
        if (overlay === currentOverlay) overlay = null
        if (previousFocus?.isConnected) previousFocus.focus?.()
        closeDialog = () => {}
      }
      text.value = '正在读取消息原文……'; dismiss.focus()
      try {
        const rows = await load()
        if (request !== generation) return
        if (!rows?.length) throw new Error('当前会话还没有可读取的消息原文，请稍后重试')
        const useful = selectedRows.length ? selectedRows : rows
        useful.forEach((row, index) => {
          const option = doc.createElement('option')
          option.value = String(index)
          option.textContent = `${index + 1}. ${row.role === 'user' ? '用户' : '助手'}：${row.text.slice(0, 80).replace(/\s+/g, ' ')}`
          select.append(option)
        })
        const paint = () => { text.value = useful[Number(select.value)].text; text.scrollTop = 0 }
        select.addEventListener('change', paint)
        select.value = String(useful.length - 1); paint()
        all.disabled = false; copy.disabled = false
      } catch {
        if (request !== generation) return
        text.value = ''
        // Gateway errors may contain connection URLs or authentication details.
        note.textContent = `${reason}。无法读取原文。请确认会话有可读取的消息并恢复连接，或重新选中消息后重试；本次未复制。`
      }
    }
  }
}
