import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fixture, fakeHost, fakeContext, tick, selectText, selectPoints, dispatchCopy } from './helpers.js'
import { startController } from '../src/controller.js'
import { projectMessage, alignProjection } from '../src/dom-adapter.js'
import { parseSource, extractSource } from '../src/source-map.js'

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

test('official Hermes CJK literal and KaTeX error DOM preserve every formula and surrounding prose', async () => {
  const source = await readFile(new URL('./fixtures/hermes-fallback-math.md', import.meta.url), 'utf8')
  const html = await readFile(new URL('./fixtures/hermes-fallback-math.html', import.meta.url), 'utf8')
  const f = await fixture(source)
  f.root.querySelector('.aui-md').outerHTML = html
  assert.ok(f.root.querySelectorAll('.katex-error').length >= 3)
  const model = parseSource(source)
  const aligned = alignProjection(projectMessage(f.root), model)
  assert.ok(aligned, 'The entire mixed body must match, including malformed formulas')
  const { host } = fakeHost([{ role: 'assistant', text: source }])
  const ctx = fakeContext()
  startController(host, ctx, f)
  await tick()
  selectText(f.doc, '普通区域', 1)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '**普通区域**')
  selectText(f.doc, '后续文字')
  assert.equal(dispatchCopy(f).data.get('text/plain'), '**后续文字**')
  // Every original math atom, including both repeated Chinese expressions,
  // inline/display failures, alternate delimiters, escapes and table cells.
  for (let index = 0; index < model.tokens.length; index++) {
    const math = model.tokens[index].members.find(u => u.kind === 'math')
    if (!math) continue
    const member = aligned.tokens[index].members.find(u => !u.synthetic)
    if (member.kind === 'math') {
      const walker = f.doc.createTreeWalker(member.element, 4)
      const node = walker.nextNode()
      selectPoints(f.doc, node, 0, node, Math.min(1, node.length))
    } else selectPoints(f.doc, member.node, member.from, member.node, member.to)
    assert.equal(dispatchCopy(f).data.get('text/plain'), extractSource(model, index, index + 1))
  }
  selectText(f.doc, '中文分子')
  f.doc.getSelection().setBaseAndExtent(f.doc.getSelection().focusNode, f.doc.getSelection().focusOffset,
    f.doc.getSelection().anchorNode, f.doc.getSelection().anchorOffset)
  assert.equal(dispatchCopy(f).data.get('text/plain'), '$\\ln\\frac{\\text{中文分子}}{\\text{中文分母}}$')
  const paragraphs = f.root.querySelectorAll('p')
  const range = f.doc.createRange(); range.setStartBefore(paragraphs[0]); range.setEndAfter(paragraphs[0])
  f.doc.getSelection().removeAllRanges(); f.doc.getSelection().addRange(range)
  assert.equal(dispatchCopy(f).data.get('text/plain'), source.slice(0, source.indexOf('\n\n')))
  ctx.dispose()
})
