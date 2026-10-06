import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, selectText, selectPoints, textPoint, copyRange } from './helpers.js'
import { parseSource, extractSource } from '../src/source-map.js'

for (const [source, selected, expected] of [
  ['这是中文。', '中文', '中文'],
  ['__一段文字__', '文字', '__文字__'],
  ['*这是斜体*', '斜体', '*斜体*'],
  ['~~删除这段~~', '这段', '~~这段~~'],
  ['__外层 *内层文字* 结束__', '文字', '__*文字*__'],
  ['[一段链接](https://example.com "标题")', '链接', '[链接](https://example.com "标题")'],
  ['``a ` b``', 'b', '``b``'],
  ['开头  中间\t末尾', '中间', '中间'],
  ['转义 \\* 和 &amp; 结束', '*', '\\*'],
  ['转义 \\* 和 &amp; 结束', '&', '&amp;'],
  ['# 原始标题', '标题', '# 标题'],
  ['## 原始标题 ##', '标题', '## 标题 ##'],
  ['原始标题\n======', '标题', '标题\n======'],
  ['`a\nb`', 'b', '`b`'],
  ['- 第一个\n- 第二个', '第二个', '- 第二个'],
  ['3) 第一个\n4) 第二个', '第二个', '4) 第二个'],
  ['> 引用文字', '文字', '> 文字'],
  ['> - 嵌套文字', '文字', '> - 文字'],
  ['```js\nconst x = 1;\n```', 'x', '```js\nx\n```'],
  ['~~~python\nx = 1\n~~~', 'x', '~~~python\nx\n~~~'],
  ['| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |', '二', '| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |']
]) {
  test(`exact selection: ${source}`, async () => {
    const f = await fixture(source)
    assert.equal(copyRange(f, selectText(f.doc, selected)), expected)
  })
}

for (const source of ['$x^2 + \\frac{1}{2}$', '$$\nx^2 + \\frac{1}{2}\n$$', '\\(x^2 + \\frac{1}{2}\\)', '\\[\nx^2 + \\frac{1}{2}\n\\]']) {
  test(`formula retains original delimiters: ${source}`, async () => {
    const f = await fixture(source.includes('\n') ? `前面\n\n${source}\n\n后面` : `前面 ${source} 后面`)
    const mathText = f.doc.querySelector('.katex-html .mord').firstChild
    const range = selectPoints(f.doc, mathText, 0, mathText, Math.min(1, mathText.textContent.length))
    assert.equal(copyRange(f, range), source)
  })
}

test('standalone display math and mixed complete paragraph', async () => {
  const source = '开始\n\n\\[\nx + y\n\\]\n\n__结束__'
  const f = await fixture(source)
  const first = textPoint(f.doc, '开始'), last = textPoint(f.doc, '结束')
  const range = selectPoints(f.doc, first.node, first.at, last.node, last.at + 2)
  assert.equal(copyRange(f, range), source)
})

test('repeated text uses selected occurrence and original mark spelling', async () => {
  const f = await fixture('**相同** 和 __相同__')
  assert.equal(copyRange(f, selectText(f.doc, '相同', 1)), '__相同__')
})

test('cross-inline boundary closes only the missing markup', async () => {
  const f = await fixture('**加粗文字** 接着 *斜体文字*')
  const first = textPoint(f.doc, '加粗文字'), last = textPoint(f.doc, '斜体文字')
  assert.equal(copyRange(f, selectPoints(f.doc, first.node, 2, last.node, 2)), '**文字** 接着 *斜体*')
})

test('source whitespace, trailing hard break and CRLF survive', async () => {
  const source = '甲  乙  \r\n丙'
  const f = await fixture(source)
  const a = textPoint(f.doc, '甲'), b = textPoint(f.doc, '丙')
  assert.equal(copyRange(f, selectPoints(f.doc, a.node, a.at, b.node, b.at + 1)), source)
})

test('multiline quoted paragraphs keep exact quote continuation', async () => {
  const source = '> 第一行\n> 第二行'
  const f = await fixture(source)
  assert.equal(copyRange(f, selectText(f.doc, '第二行')), '> 第二行')
})

test('formula notation inside code is never normalized', () => {
  const model = parseSource('`\\(x\\)`')
  assert.equal(extractSource(model, 0, model.tokens.length), '`\\(x\\)`')
})

test('reference link includes the exact reference definition', async () => {
  const source = '[链接][Ref]\n\n[Ref]: https://example.com "原始标题"'
  const f = await fixture(source)
  assert.equal(copyRange(f, selectText(f.doc, '链接')), source)
})

test('unsupported HTML cannot masquerade as source', () => {
  assert.throws(() => parseSource('<span>文字</span>'), /HTML/)
})

test('nested wrapper opening order remains correct across an inner boundary', async () => {
  const f = await fixture('**外层 _内层文字_ 结束**')
  const first = textPoint(f.doc, '内层文字'), last = textPoint(f.doc, ' 结束')
  const range = selectPoints(f.doc, first.node, first.at + 2, last.node, last.at + 3)
  assert.equal(copyRange(f, range), '**_文字_ 结束**')
})

test('KaTeX duplicates and accessible MathML never duplicate source formulas', async () => {
  const source = '$x$ 与 \\(x\\)'
  const f = await fixture(source)
  const formula = f.doc.querySelectorAll('.katex')[1]
  const range = f.doc.createRange(); range.selectNode(formula)
  assert.equal(copyRange(f, range), '\\(x\\)')
})

test('complete fenced code preserves leading and trailing empty lines and spaces', async () => {
  const source = '```text\n\n  第一行  \n第二行\n\n```'
  const f = await fixture(source)
  const range = f.doc.createRange(); range.selectNodeContents(f.doc.querySelector('pre code'))
  assert.equal(copyRange(f, range), source)
})

test('whole code with CRLF uses the original line endings', async () => {
  const source = '~~~text\r\n\r\n第一行  \r\n\r\n~~~'
  const f = await fixture(source)
  const range = f.doc.createRange(); range.selectNodeContents(f.doc.querySelector('pre code'))
  assert.equal(copyRange(f, range), source)
})

test('partial code keeps only selected body plus exact original fences', async () => {
  const source = '```text\n第一行\n第二行\n```'
  const f = await fixture(source)
  assert.equal(copyRange(f, selectText(f.doc, '第二行')), '```text\n第二行\n```')
})

test('real Hermes code card skips chrome and Shiki spans retain code content', async () => {
  const source = '```js\nconst x = 1;\n```'
  const f = await fixture(source)
  const code = f.doc.querySelector('code')
  const pre = f.doc.querySelector('pre')
  const card = f.doc.createElement('div'); card.setAttribute('data-slot', 'code-card')
  const button = f.doc.createElement('button'); button.textContent = 'Copy'
  pre.replaceWith(card); card.append(button, pre)
  code.innerHTML = '<span class="line"><span style="color:red">const</span><span> x = 1;</span></span>'
  assert.equal(copyRange(f, selectText(f.doc, 'x')), '```js\nx\n```')
})
