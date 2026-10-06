import test from 'node:test'
import assert from 'node:assert/strict'
import { makeHistory, createHistoryCache, captureScope } from '../src/history.js'
import { startController } from '../src/controller.js'
import { fakeHost, fakeContext, fixture, tick } from './helpers.js'

test('history retains only visible body fields, not reasoning or backend secrets', () => {
  const rows = makeHistory({ messages: [
    { role: 'assistant', text: 'body', timestamp: 123, reasoning: 'private reasoning', api_key: 'secret' },
    { role: 'assistant', text: 'hidden', display_kind: 'hidden' },
    { role: 'tool', text: 'tool output' }
  ] })
  assert.equal(rows.length, 1)
  assert.deepEqual(Object.keys(rows[0]).sort(), ['model', 'role', 'text', 'timestamp'])
})

test('clearing cache rejects in-flight history and requires a fresh read', async () => {
  let finish
  let calls = 0
  const { host } = fakeHost([], () => ++calls === 1 ? new Promise(resolve => { finish = resolve }) : { messages: [{ role: 'assistant', text: 'fresh' }] })
  const cache = createHistoryCache(host)
  const scope = captureScope(host)
  const pending = cache.load(scope)
  cache.clear()
  finish({ messages: [{ role: 'assistant', text: 'stale secret' }] })
  assert.equal(await pending, null)
  assert.equal(cache.get(scope), null)
  assert.equal((await cache.load(scope))[0].text, 'fresh')
  cache.dispose()
})

test('paused controller clears history and skips state/event reads until resumed', async () => {
  const f = await fixture('body')
  const { host, calls } = fakeHost([{ role: 'assistant', text: 'body' }])
  const ctx = fakeContext()
  const controller = startController(host, ctx, f)
  await tick()
  assert.ok(controller.cache.get(captureScope(host)))
  controller.commands.toggle()
  assert.equal(controller.cache.get(captureScope(host)), null)
  const count = calls.length
  host.state.focusedSessionOwner.set({ connectionId: 'other', profile: 'private' })
  ctx.emit('message.complete', { session_id: 'runtime-1' })
  await tick()
  assert.equal(calls.length, count)
  controller.commands.toggle()
  await tick()
  assert.equal(calls.length, count + 1)
  ctx.dispose()
})

test('raw dialog displays malicious HTML as literal text and masks gateway details', async () => {
  const f = await fixture('body')
  const source = '<img src="https://tracking.invalid/pixel" onerror="alert(1)"><script>steal()</script>'
  let fail = false
  const { host } = fakeHost([], () => fail ? Promise.reject(new Error('https://secret:password@private.invalid')) : { messages: [{ role: 'assistant', text: source }] })
  const ctx = fakeContext()
  const controller = startController(host, ctx, f)
  await tick()
  controller.commands.openRaw()
  await tick()
  assert.equal(f.doc.querySelector('textarea').value, source)
  assert.equal(f.doc.querySelector('[role="dialog"] img, [role="dialog"] script'), null)
  fail = true
  controller.cache.clear()
  controller.commands.openRaw()
  await tick()
  assert.doesNotMatch(f.doc.querySelector('[role="dialog"]').textContent, /password|private\.invalid/)
  ctx.dispose()
})
