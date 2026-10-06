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
