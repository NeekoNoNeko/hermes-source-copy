import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fixture, fakeHost, fakeContext, tick, selectText, selectPoints, dispatchCopy } from './helpers.js'
import { startController } from '../src/controller.js'
import { projectMessage } from '../src/dom-adapter.js'
import { parseSource } from '../src/source-map.js'

const source = await readFile(new URL('./fixtures/hermes-math.md', import.meta.url), 'utf8')
const html = await readFile(new URL('./fixtures/hermes-math.html', import.meta.url), 'utf8')

test('official Hermes Streamdown/math DOM copies bold, formulas, and table with live/stored timing mismatch', async () => {
  const f = await fixture(source)
  f.root.querySelector('.aui-md').outerHTML = html
  // Real-world failure: the source matches but the renderer id's authoring
  // time differs from the current history row. These are not stable row ids.
  f.root.setAttribute('data-message-id', '1700000000.123-5-assistant')
  assert.equal(projectMessage(f.root).signature, parseSource(source).signature)
  const { host } = fakeHost([{ role: 'assistant', text: source, timestamp: 1700000000.456 }])
  const ctx = fakeContext()
  startController(host, ctx, f)
  await tick()
  selectText(f.doc, '关键规则')
  assert.equal(dispatchCopy(f).data.get('text/plain'), '**关键规则**')
  const formulas = [...f.doc.querySelectorAll('.katex')]
  const formula = expression => formulas.find(el => el.querySelector('annotation')?.textContent.trim() === expression)
  for (const [expression, original] of [
    ['x=0', '$x=0$'],
    ['f(x)=a_0+a_1x+\\frac{x^2}{2!}+o(x^2)', '$$\nf(x)=a_0+a_1x+\\frac{x^2}{2!}+o(x^2)\n$$'],
    ['x^2', '\\(x^2\\)'],
    ['x+y', '\\[\nx+y\n\\]']
  ]) {
    const math = formula(expression)
    assert.ok(math, expression)
    const range = f.doc.createRange(); range.selectNode(math)
    f.doc.getSelection().removeAllRanges(); f.doc.getSelection().addRange(range)
    assert.equal(dispatchCopy(f).data.get('text/plain'), original)
  }
  selectText(f.doc, '⚠️非阶乘')
  assert.equal(dispatchCopy(f).data.get('text/plain'), source.slice(source.indexOf('| 函数'), source.indexOf('\n\n最后')))
  ctx.dispose()
})
