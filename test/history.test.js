import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistoryCache, captureScope } from '../src/history.js'
import { fakeHost } from './helpers.js'

test('persisted compacted history pages in raw offsets, retains old replies and deduplicates live tail', async () => {
  const { host } = fakeHost([{ role: 'assistant', text: '**最新回复**', row_id: 4 }])
  host.state.focusedSessionOwner.set({ connectionId: 'remote-a', profile: 'work' })
  host.state.focusedStoredSessionId.set('stored/id')
  const requests = []
  const cache = createHistoryCache(host, { readPersisted: async request => {
    requests.push(request)
    const offset = Number(new URL(request.path, 'https://test.invalid').searchParams.get('offset'))
    return { profile: 'work', pagination: { order: 'oldest', offset }, messages: offset === 0 ? [
      { role: 'user', text: '旧问题', row_id: 1 }, { role: 'assistant', text: '__旧回复__', row_id: 2 }
    ] : offset === 500 ? [
      { role: 'user', text: '新问题', row_id: 3 }, { role: 'assistant', text: '**最新回复**', row_id: 4 }
    ] : [] }
  } })
  const rows = await cache.load(captureScope(host))
  assert.deepEqual(rows.map(row => row.text), ['旧问题', '__旧回复__', '新问题', '**最新回复**'])
  assert.ok(rows.every(row => row.model))
  assert.equal(requests.length, 3)
  requests.forEach((request, index) => {
    assert.equal(request.connectionId, 'remote-a'); assert.equal(request.profile, 'work')
    assert.equal(request.method, 'GET')
    const url = new URL(request.path, 'https://test.invalid')
    assert.equal(url.pathname, '/api/sessions/stored%2Fid/messages')
    assert.equal(url.searchParams.get('profile'), 'work')
    assert.equal(url.searchParams.get('include_compacted'), 'true')
    assert.equal(url.searchParams.get('inline_images'), 'false')
    assert.equal(url.searchParams.get('offset'), String(index * 500))
  })
  cache.dispose()
})

test('unique shared durable row joins only a not-yet-persisted live tail', async () => {
  const { host } = fakeHost([
    { role: 'assistant', text: '重复', row_id: 2 }, { role: 'assistant', text: '新回复', row_id: 3 }
  ])
  const cache = createHistoryCache(host, { readPersisted: async request => ({ messages: request.path.includes('offset=0&') ? [
    { role: 'assistant', text: '重复', row_id: 1 }, { role: 'assistant', text: '重复', row_id: 2 }
  ] : [] }) })
  assert.deepEqual((await cache.load(captureScope(host))).map(row => row.text), ['重复', '重复', '新回复'])
  cache.dispose()
})

test('ambiguous unstamped overlap never fabricates an ordered merged history', async () => {
  const { host } = fakeHost([{ role: 'assistant', text: '重复' }, { role: 'assistant', text: '未确认尾段' }])
  const cache = createHistoryCache(host, { readPersisted: async request => ({ messages: request.path.includes('offset=0&') ? [
    { role: 'assistant', text: '重复' }, { role: 'assistant', text: '重复' }
  ] : [] }) })
  assert.deepEqual((await cache.load(captureScope(host))).map(row => row.text), ['重复', '重复'])
  cache.dispose()
})

test('REST body projection excludes tools, hidden messages and private metadata', async () => {
  const { host } = fakeHost([], () => Promise.reject(new Error('private RPC diagnostic')))
  const cache = createHistoryCache(host, { readPersisted: async request => ({ data: request.path.includes('offset=0&') ? [
    { role: 'assistant', content: '存档正文', id: 10, reasoning: 'secret reasoning', api_key: 'secret' },
    { role: 'tool', content: 'secret tool' }, { role: 'assistant', content: 'hidden', display_kind: 'hidden' }
  ] : [] }) })
  const rows = await cache.load(captureScope(host))
  assert.equal(rows.length, 1); assert.equal(rows[0].text, '存档正文')
  assert.deepEqual(Object.keys(rows[0]).sort(), ['model', 'role', 'text', 'timestamp'])
  cache.dispose()
})

test('REST unavailable or wrong profile/order keeps qualified RPC source', async () => {
  for (const mode of ['unavailable', 'profile', 'order', 'size']) {
    const { host } = fakeHost([{ role: 'assistant', text: '实时正文' }])
    const cache = createHistoryCache(host, { readPersisted: async () => {
      if (mode === 'unavailable') throw new Error('private REST diagnostic')
      return { messages: [{ role: 'assistant', text: '错误归属' }], profile: mode === 'profile' ? 'other' : 'default', pagination: { order: mode === 'order' ? 'latest' : 'oldest', offset: 0, limit: mode==='size'?120:500 } }
    } })
    assert.deepEqual((await cache.load(captureScope(host))).map(row => row.text), ['实时正文'])
    cache.dispose()
  }
})

test('invalidating or disposing during stored paging stops reads and rejects old rows', async () => {
  for (const action of ['clear', 'dispose', 'invalidate']) {
    const { host } = fakeHost([{ role: 'assistant', text: '实时正文' }])
    let finish, calls = 0
    const cache = createHistoryCache(host, { readPersisted: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
    const scope = captureScope(host), pending = cache.load(scope)
    if (action === 'invalidate') cache.invalidate(scope); else cache[action]()
    finish({ messages: [{ role: 'assistant', text: '过期的存档正文' }] })
    assert.equal(await pending, null); assert.equal(cache.get(scope), null); assert.equal(calls, 1)
    cache.dispose()
  }
})

test('legacy complete transcript without paging metadata is read once', async () => {
  const {host}=fakeHost([{role:'assistant',text:'新回复'}])
  let calls=0
  const cache=createHistoryCache(host,{readPersisted:async()=>{
    calls++
    return {messages:[null,{role:'assistant',text:'旧回复'},{role:'assistant',text:'新回复'}]}
  }})
  assert.deepEqual((await cache.load(captureScope(host))).map(row=>row.text),['旧回复','新回复'])
  assert.equal(calls,1)
  cache.dispose()
})
