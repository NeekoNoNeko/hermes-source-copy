import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fixture, fakeHost, fakeContext, selectText, dispatchCopy, tick } from './helpers.js'

test('production ESM bundle loads, registers and copies using SDK alone', async () => {
  const bundle = await readFile('dist/hermes-source-copy/plugin.js', 'utf8')
  assert.equal(await readFile('plugin.js', 'utf8'), bundle)
  const info = JSON.parse(await readFile('dist/hermes-source-copy/build-info.json', 'utf8'))
  assert.equal(info.sha256, createHash('sha256').update(bundle).digest('hex'))
  assert.match(bundle, /from "@hermes\/plugin-sdk"/)
  assert.doesNotMatch(bundle, /\beval\s*\(|new Function\s*\(/)
  const f = await fixture('__生产包原文__')
  const { host } = fakeHost([{ role: 'assistant', text: '__生产包原文__' }])
  const ctx = fakeContext()
  const contributions = []
  ctx.registerMany = rows => { contributions.push(...rows) }
  const globals = { document: globalThis.document, window: globalThis.window, host: globalThis.__hermesSourceCopyTestHost }
  globalThis.document = f.doc; globalThis.window = f.win; globalThis.__hermesSourceCopyTestHost = host
  try {
    const sdkUrl = 'data:text/javascript,' + encodeURIComponent('export const host=globalThis.__hermesSourceCopyTestHost;export const PALETTE_AREA="palette";')
    const module = await import('data:text/javascript;base64,' + Buffer.from(bundle.replace('"@hermes/plugin-sdk"', JSON.stringify(sdkUrl))).toString('base64'))
    assert.equal(module.default.id, 'hermes-source-copy')
    assert.equal(typeof module.default.register, 'function')
    module.default.register(ctx)
    await tick()
    assert.equal(contributions.length, 2)
    selectText(f.doc, '原文')
    assert.equal(dispatchCopy(f).data.get('text/plain'), '__原文__')
  } finally {
    ctx.dispose()
    if (globals.document === undefined) delete globalThis.document; else globalThis.document = globals.document
    if (globals.window === undefined) delete globalThis.window; else globalThis.window = globals.window
    if (globals.host === undefined) delete globalThis.__hermesSourceCopyTestHost; else globalThis.__hermesSourceCopyTestHost = globals.host
  }
})
