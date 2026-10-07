import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, selectText, selectPoints, fakeHost, fakeContext, dispatchCopy, tick, textPoint } from './helpers.js'
import { startController } from '../src/controller.js'
import { describeSelection, matchHistory, projectMessage } from '../src/dom-adapter.js'
import { parseSource } from '../src/source-map.js'

async function controllerFixture(source, rows = [{ role: 'assistant', text: source }], requestOverride) {
  const f = await fixture(source)
  const mock = fakeHost(rows, requestOverride)
  const ctx = fakeContext()
  const controller = startController(mock.host, ctx, f)
  await tick()
  return { ...f, ...mock, ctx, controller }
}

async function openSelectionMenu(f, label = '复制') {
  const target = f.doc.getSelection().anchorNode.parentElement
  target.dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const menu = f.doc.createElement('div')
  menu.setAttribute('data-slot', 'dropdown-menu-content'); menu.setAttribute('role', 'menu')
  menu.innerHTML = '<div data-slot="dropdown-menu-item" role="menuitem"><i class="codicon codicon-copy" aria-hidden="true"></i><span></span></div>'
  menu.querySelector('span').textContent = label
  f.doc.body.append(menu)
  // Model the native Radix focus trap losing the document selection.
  f.doc.getSelection().removeAllRanges()
  menu.addEventListener('keydown', event => { if (event.key === 'Escape') menu.remove() })
  await tick()
  return { menu, item: menu.firstElementChild }
}

for (const [label, action] of [['复制', 'click'], ['Copy', 'Enter'], ['複製', ' ']]) {
  test(`original context-menu ${label}/${action} copies source after focus loss and blocks the native plain-text writer`, async () => {
    const f = await controllerFixture('__一段文字__')
    const writes = []
    f.ctx.os.writeClipboard = async text => { writes.push(text); return true }
    let native = 0
    f.doc.addEventListener(action === 'click' ? 'click' : 'keydown', event => { if (action === 'click' || event.key === action) native++ })
    selectText(f.doc, '文字')
    const { item, menu } = await openSelectionMenu(f, label)
    const event = action === 'click' ? new f.win.MouseEvent('click', { bubbles: true, cancelable: true }) :
      new f.win.KeyboardEvent('keydown', { key: action, bubbles: true, cancelable: true })
    item.dispatchEvent(event)
    await tick()
    assert.equal(event.defaultPrevented, true)
    assert.deepEqual(writes, ['__文字__'])
    assert.equal(native, 0)
    assert.equal(menu.isConnected, false)
    f.ctx.dispose()
  })
}

test('right-click formula copies original delimiters, including partial selection in an error span', async () => {
  const source = '**$\\frac{x}{ $**'
  const f = await controllerFixture(source)
  f.root.querySelector('.aui-md').innerHTML = '<p><strong><span class="katex-error" title="untrusted error details">\\frac{x}{ </span></strong></p>'
  const writes = []
  f.ctx.os.writeClipboard = async text => { writes.push(text); return true }
  const node = f.root.querySelector('.katex-error').firstChild
  selectPoints(f.doc, node, 2, node, 3)
  const { item } = await openSelectionMenu(f)
  item.click(); await tick()
  assert.deepEqual(writes, [source])
  f.ctx.dispose()
})

test('right-click unready source blocks native write and opens the raw window', async () => {
  let resolve
  const f = await controllerFixture('**正文**', undefined, () => new Promise(r => { resolve = r }))
  const writes = []
  f.ctx.os.writeClipboard = async text => { writes.push(text); return true }
  selectText(f.doc, '正文')
  const { item } = await openSelectionMenu(f)
  const event = new f.win.MouseEvent('click', { bubbles: true, cancelable: true }); item.dispatchEvent(event)
  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(writes, [])
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  resolve({ messages: [{ role: 'assistant', text: '**正文**' }] }); await tick()
  f.ctx.dispose()
})

test('right-click SDK failure opens raw source without invoking the native plain-text action', async () => {
  for (const mode of ['false', 'reject']) {
    const f = await controllerFixture('**正文**')
    f.ctx.os.writeClipboard = async () => { if (mode === 'reject') throw new Error('private operating system details'); return false }
    selectText(f.doc, '正文')
    const { item } = await openSelectionMenu(f)
    const event = new f.win.MouseEvent('click', { bubbles: true, cancelable: true }); item.dispatchEvent(event)
    await tick()
    assert.equal(event.defaultPrevented, true)
    assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
    assert.equal(f.notices.at(-1).message.includes('private'), false)
    f.ctx.dispose()
  }
})

test('right-click cannot reuse a detached source surface or a mutated body', async () => {
  for (const change of ['detach', 'mutate']) {
    const f = await controllerFixture('**正文**')
    const writes = []
    f.ctx.os.writeClipboard = async text => { writes.push(text); return true }
    selectText(f.doc, '正文')
    const { item } = await openSelectionMenu(f)
    if (change === 'detach') f.root.parentElement.remove()
    else f.root.querySelector('strong').textContent = '新的正文'
    item.click(); await tick()
    assert.deepEqual(writes, [])
    assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
    f.ctx.dispose()
  }
})

test('right-click link action, unrelated menu, dismissed menu, pause and unload keep ordinary behavior', async () => {
  for (const change of ['link', 'unrelated', 'dismiss', 'pause', 'unload']) {
    const f = await controllerFixture('**正文**')
    const writes = []
    f.ctx.os.writeClipboard = async text => { writes.push(text); return true }
    selectText(f.doc, '正文')
    const { item, menu } = await openSelectionMenu(f, change === 'link' ? '复制链接' : '复制')
    let target = item
    if (change === 'unrelated') {
      const other = menu.cloneNode(true); f.doc.body.append(other); await tick(); target = other.firstElementChild
    }
    if (change === 'dismiss') item.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (change === 'pause') f.controller.commands.toggle()
    if (change === 'unload') f.ctx.dispose()
    const event = new f.win.MouseEvent('click', { bubbles: true, cancelable: true }); target.dispatchEvent(event)
    assert.equal(event.defaultPrevented, false, change)
    assert.deepEqual(writes, [], change)
    f.ctx.dispose()
  }
})

test('update command opens only the official fixed-repository force-install confirmation link', async () => {
  const f = await controllerFixture('正文')
  const urls = []
  f.ctx.os.openExternal = async url => { urls.push(url); return true }
  await f.controller.commands.update()
  assert.deepEqual(urls, ['hermes://plugin/install?repo=NeekoNoNeko/hermes-source-copy&force=1'])
  f.ctx.dispose()
})

test('literal math alignment does not choose among indistinguishable source candidates', async () => {
  const source = '$\\text{重复中文}$'
  const f = await controllerFixture(source, [{ role: 'assistant', text: source }, { role: 'assistant', text: '\\$\\text{重复中文}\\$' }])
  f.root.querySelector('.aui-md').innerHTML = '<p>$\\text{重复中文}$</p>'
  selectText(f.doc, '重复中文')
  assert.equal(dispatchCopy(f).data.get('text/plain'), 'previous clipboard')
  await tick()
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  f.ctx.dispose()
})

test('Ctrl+C writes only original source and beats the document colour guard', async () => {
  const f = await controllerFixture('__一段文字__')
  let nativeCalls = 0
  f.doc.addEventListener('copy', event => { nativeCalls++; event.preventDefault(); event.clipboardData.setData('text/plain', 'native plain text') }, true)
  selectText(f.doc, '文字')
  const result = dispatchCopy(f, { 'text/plain': 'old', 'text/html': '<b>old</b>' })
  assert.equal(result.event.defaultPrevented, true)
  assert.equal(result.data.get('text/plain'), '__文字__')
  assert.equal(result.data.has('text/html'), false)
  assert.equal(nativeCalls, 0)
  f.ctx.dispose()
})

test('repeated identical rows are ambiguous instead of choosing first occurrence', async () => {
  const f = await controllerFixture('**相同**', [{ role: 'assistant', text: '**相同**' }, { role: 'assistant', text: '**相同**' }])
  selectText(f.doc, '相同')
  const { data } = dispatchCopy(f)
  assert.equal(data.get('text/plain'), 'previous clipboard')
  await tick()
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  assert.equal(f.doc.querySelector('textarea').value, '**相同**')
  f.ctx.dispose()
})

test('ordered visible context disambiguates repeated history', () => {
  const history = ['重复', '锚点', '重复'].map(text => ({ role: 'assistant', model: parseSource(text), text }))
  const visible = ['锚点', '重复'].map(text => ({ role: 'assistant', signature: parseSource(text).signature }))
  assert.deepEqual(matchHistory(visible, history).map(row => row.text), ['锚点', '重复'])
})

test('ephemeral renderer timestamp cannot reject exact source or poison other messages', async () => {
  const f = await controllerFixture('**唯一回答**', [
    { role: 'assistant', text: '**唯一回答**', timestamp: 100.25 },
    { role: 'assistant', text: '__另一条__', timestamp: 200 }
  ])
  f.root.setAttribute('data-message-id', '100.12-0-assistant')
  const second = f.root.cloneNode(true)
  second.setAttribute('data-message-id', '200-1-assistant')
  second.querySelector('.aui-md').innerHTML = '<p><strong>另一条</strong></p>'
  f.root.parentElement.append(second)
  selectText(f.doc, '唯一回答')
  assert.equal(dispatchCopy(f).data.get('text/plain'), '**唯一回答**')
  const node = second.querySelector('strong').firstChild
  selectPoints(f.doc, node, 0, node, node.length)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__另一条__')
  f.ctx.dispose()
})

test('ephemeral timestamps cannot resolve duplicate ambiguity; visible position can', () => {
  const history = ['**相同**', '__相同__'].map((text, index) => ({ role: 'assistant', timestamp: index + 1, model: parseSource(text), text }))
  const signature = parseSource('相同').signature
  assert.equal(matchHistory([{ role: 'assistant', signature, messageId: '2-0-assistant' }], history)[0], null)
  assert.equal(matchHistory([{ role: 'assistant', signature, messageId: '9-0-assistant' }], history)[0], null)
  assert.deepEqual(matchHistory([
    { role: 'assistant', signature, messageId: '2-0-assistant' },
    { role: 'assistant', signature, messageId: '1-1-assistant' }
  ], history).map(row => row.text), ['**相同**', '__相同__'])
})

test('one rendered assistant root maps multiple persisted text parts around tools', async () => {
  const f = await controllerFixture('**前段文字**', [
    { role: 'assistant', text: '**前段文字**', timestamp: 1 },
    { role: 'tool', text: 'private tool output' },
    { role: 'assistant', text: '__后段文字__', timestamp: 3 }
  ])
  f.root.setAttribute('data-message-id', '1-0-assistant')
  const content = f.root.querySelector('[data-slot="aui_assistant-message-content"]')
  const scaffold = f.doc.createElement('div')
  scaffold.setAttribute('data-conversation-scaffold', '')
  scaffold.innerHTML = '<div class="aui-md"><p>private tool output</p></div>'
  const second = f.doc.createElement('div')
  second.className = 'aui-md'; second.innerHTML = '<p><strong>后段文字</strong></p>'
  content.append(scaffold, second)
  selectPoints(f.doc, second.querySelector('strong').firstChild, 2, second.querySelector('strong').firstChild, 4)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__文字__')
  selectPoints(f.doc, f.root.querySelector('strong').firstChild, 0, second.querySelector('strong').firstChild, 4)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '**前段文字**\n\n__后段文字__')
  f.ctx.dispose()
})

test('a selected unmatched text part is never silently omitted from merged copying', async () => {
  const f = await controllerFixture('**前段文字**')
  const second = f.doc.createElement('div')
  second.className = 'aui-md'; second.innerHTML = '<p>尚未持久化的文字</p>'
  f.root.querySelector('[data-slot="aui_assistant-message-content"]').append(second)
  const pending = second.querySelector('p').firstChild
  selectPoints(f.doc, f.root.querySelector('strong').firstChild, 0, pending, pending.length)
  assert.equal(dispatchCopy(f).data.get('text/plain'), 'previous clipboard')
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  f.ctx.dispose()
})

test('Markdown in excluded ancestor is not mistaken for assistant body', async () => {
  const f = await controllerFixture('__真正正文__')
  const scaffold = f.doc.createElement('div')
  scaffold.setAttribute('data-conversation-scaffold', '')
  scaffold.innerHTML = '<div class="aui-md"><p>工具详情正文</p></div>'
  f.root.querySelector('[data-slot="aui_assistant-message-content"]').prepend(scaffold)
  selectPoints(f.doc, f.root.querySelector('strong').firstChild, 0, f.root.querySelector('strong').firstChild, 4)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__真正正文__')
  selectPoints(f.doc, scaffold.querySelector('p').firstChild, 0, scaffold.querySelector('p').firstChild, 6)
  assert.equal(dispatchCopy(f).event.defaultPrevented, false)
  f.ctx.dispose()
})

test('raw view is usable while source mapping fails', async () => {
  const f = await controllerFixture('文字')
  f.root.querySelector('.aui-md').innerHTML = '<span>改写后的文字</span>'
  selectText(f.doc, '文字')
  dispatchCopy(f)
  await tick()
  const area = f.doc.querySelector('textarea')
  assert.equal(area.value, '文字')
  area.focus(); area.select()
  const result = dispatchCopy(f)
  assert.equal(result.event.defaultPrevented, false)
  f.ctx.dispose()
})

test('input, terminal, settings and empty selections pass through', async () => {
  const f = await controllerFixture('文字')
  for (const [tag, attrs] of [['textarea', {}], ['div', { contenteditable: 'true' }], ['div', { 'data-terminal': '' }], ['div', { 'data-settings-page': '' }]]) {
    const el = f.doc.createElement(tag)
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
    if (tag === 'textarea') el.value = '输入内容'
    else el.textContent = '选中文字'
    f.doc.body.append(el)
    if (tag === 'textarea') { el.focus(); el.select(); f.doc.getSelection().removeAllRanges() }
    else selectPoints(f.doc, el.firstChild, 0, el.firstChild, 4)
    assert.equal(dispatchCopy(f).event.defaultPrevented, false)
    el.remove()
  }
  f.doc.getSelection().removeAllRanges()
  assert.equal(dispatchCopy(f).event.defaultPrevented, false)
  f.ctx.dispose()
})

test('reverse selection copies the same exact original', async () => {
  const f = await controllerFixture('__中文文字__')
  const { node, at } = textPoint(f.doc, '中文文字')
  f.doc.getSelection().setBaseAndExtent(node, at + 4, node, at + 2)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__文字__')
  f.ctx.dispose()
})

test('cross-message selection preserves source and joins without role labels', async () => {
  const f = await controllerFixture('__第一条__', [{ role: 'assistant', text: '__第一条__' }, { role: 'assistant', text: '*第二条*' }])
  const second = f.root.cloneNode(true)
  second.querySelector('.aui-md').innerHTML = '<p><em>第二条</em></p>'
  f.root.parentElement.append(second)
  selectPoints(f.doc, f.root.querySelector('strong').firstChild, 0, second.querySelector('em').firstChild, 3)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__第一条__\n\n*第二条*')
  f.ctx.dispose()
})

test('cross-chat selection opens raw view and does not write guessed source', async () => {
  const f = await controllerFixture('第一条')
  const other = f.doc.querySelector('[data-chat-surface]').cloneNode(true)
  other.querySelector('.aui-md').innerHTML = '<p>第二条</p>'
  f.doc.body.append(other)
  const first = f.root.querySelector('p').firstChild, second = other.querySelector('p').firstChild
  selectPoints(f.doc, first, 0, second, 3)
  const result = dispatchCopy(f)
  assert.equal(result.event.defaultPrevented, true)
  assert.equal(result.data.get('text/plain'), 'previous clipboard')
  f.ctx.dispose()
})

test('unready source blocks copy and asynchronously opens the original text', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const f = await controllerFixture('__原文__', [], () => pending)
  selectText(f.doc, '原文')
  const result = dispatchCopy(f)
  assert.equal(result.data.get('text/plain'), 'previous clipboard')
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  finish({ messages: [{ role: 'assistant', text: '__原文__' }] })
  await tick()
  assert.equal(f.doc.querySelector('textarea').value, '__原文__')
  f.ctx.dispose()
})

test('streaming invalidates source and does not repair incomplete syntax', async () => {
  const f = await controllerFixture('__原文__')
  selectText(f.doc, '原文')
  f.ctx.emit('message.delta', { session_id: 'runtime-1', text: '新' })
  assert.equal(dispatchCopy(f).data.get('text/plain'), 'previous clipboard')
  f.ctx.dispose()
})

test('a visible streaming marker forces raw view even with cached source', async () => {
  const f = await controllerFixture('原文')
  const marker = f.doc.createElement('span'); marker.setAttribute('data-message-streaming', 'true'); f.root.append(marker)
  selectText(f.doc, '原文')
  assert.equal(dispatchCopy(f).data.get('text/plain'), 'previous clipboard')
  f.ctx.dispose()
})

test('profile and connection route remains explicitly qualified', async () => {
  const f = await controllerFixture('原文')
  f.host.state.focusedSessionOwner.set({ connectionId: 'server-B', profile: 'default' })
  await tick()
  const [route, method, params] = f.calls.at(-1)
  assert.deepEqual(route, { connectionId: 'server-B', profile: 'default', targetProfile: 'default', mode: 'remote' })
  assert.equal(method, 'session.history')
  assert.equal(params.session_id, 'runtime-1')
  f.ctx.dispose()
})

test('selection in primary chat cannot read a different focused tile', async () => {
  const f = await controllerFixture('__原文__')
  f.host.state.focusedSessionId.set('tile-runtime')
  await tick()
  selectText(f.doc, '原文')
  assert.equal(dispatchCopy(f).data.get('text/plain'), 'previous clipboard')
  f.ctx.dispose()
})

test('unrelated unsupported message does not disable source copying elsewhere', async () => {
  const f = await controllerFixture('__原文__', [{ role: 'assistant', text: '<b>特殊消息</b>' }, { role: 'assistant', text: '__原文__' }])
  const other = f.root.cloneNode(true)
  other.querySelector('.aui-md').innerHTML = '<p><b>特殊消息</b></p>'
  f.root.parentElement.prepend(other)
  selectPoints(f.doc, f.root.querySelector('strong').firstChild, 0, f.root.querySelector('strong').firstChild, 2)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__原文__')
  f.ctx.dispose()
})

test('switching session rejects old asynchronous replies', async () => {
  let resolveOld
  const old = new Promise(resolve => { resolveOld = resolve })
  const f = await controllerFixture('旧原文', [], (route, method, params) => params.session_id === 'runtime-1' ? old : { messages: [{ role: 'assistant', text: '新原文' }] })
  selectText(f.doc, '旧原文'); dispatchCopy(f)
  f.host.state.focusedSessionId.set('runtime-2'); f.host.state.focusedStoredSessionId.set('stored-2')
  resolveOld({ messages: [{ role: 'assistant', text: '旧原文' }] })
  await tick()
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'), null)
  assert.equal(f.controller.cache.get({ key: JSON.stringify(['local', 'default', 'stored-2', 'runtime-2']) })[0].text, '新原文')
  f.ctx.dispose()
})

test('disconnect reports read error without changing clipboard', async () => {
  const f = await controllerFixture('原文', [], () => Promise.reject(new Error('Gateway disconnected')))
  selectText(f.doc, '原文')
  const result = dispatchCopy(f)
  await tick()
  assert.equal(result.data.get('text/plain'), 'previous clipboard')
  assert.match(f.doc.querySelector('[role="dialog"]').textContent, /无法读取原文/)
  assert.doesNotMatch(f.doc.querySelector('[role="dialog"]').textContent, /Gateway disconnected/)
  f.ctx.dispose()
})

test('toggle restores native copy; unload removes listeners, dialog and atom subscriptions', async () => {
  const f = await controllerFixture('__原文__')
  selectText(f.doc, '原文')
  f.controller.commands.toggle()
  assert.equal(dispatchCopy(f).event.defaultPrevented, false)
  f.controller.commands.toggle()
  await tick()
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__原文__')
  f.controller.commands.openRaw(); await tick()
  f.ctx.dispose()
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'), null)
  assert.equal(f.host.state.focusedSessionId.count, 0)
  selectText(f.doc, '原文')
  assert.equal(dispatchCopy(f).event.defaultPrevented, false)
  // Simulate hot reload into the same window.
  const ctx2 = fakeContext()
  startController(f.host, ctx2, f); await tick()
  assert.equal(dispatchCopy(f).data.get('text/plain'), '__原文__')
  ctx2.dispose()
})

test('selection only in reasoning is left to normal copy', async () => {
  const f = await controllerFixture('正文')
  const thinking = f.doc.createElement('div')
  thinking.setAttribute('data-slot', 'aui_thinking-disclosure')
  thinking.innerHTML = '<div class="aui-md"><p>推理</p></div>'
  f.root.querySelector('[data-slot="aui_assistant-message-content"]').prepend(thinking)
  selectPoints(f.doc, thinking.querySelector('p').firstChild, 0, thinking.querySelector('p').firstChild, 2)
  assert.equal(describeSelection(f.doc), null)
  assert.equal(dispatchCopy(f).event.defaultPrevented, false)
  f.ctx.dispose()
})

test('user bubble plain Markdown and backtick code get original source', async () => {
  const f = await controllerFixture('placeholder', [{ role: 'user', text: '__用户文字__ 和 `代码`' }])
  f.root.setAttribute('data-role', 'user'); f.root.setAttribute('data-slot', 'aui_user-message-root')
  f.root.innerHTML = '<span data-slot="aui_user-message-text"><span data-slot="aui_user-inline-text">__用户文字__ 和 <code>代码</code></span></span>'
  const code = f.root.querySelector('code').firstChild
  selectPoints(f.doc, code, 0, code, 2)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '`代码`')
  f.ctx.dispose()
})
