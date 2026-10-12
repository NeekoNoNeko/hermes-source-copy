import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture, selectText, selectPoints, textPoint, copyRange, fakeContext, fakeHost, tick, dispatchCopy} from './helpers.js'
import {startController} from '../src/controller.js'

function selectContents(f, element) {
  const range=f.doc.createRange();range.selectNodeContents(element)
  f.doc.getSelection().removeAllRanges();f.doc.getSelection().addRange(range)
  return range
}

test('a single header or body cell copies its contents without table pipes or other cells',async()=>{
  const source='| **表头文字** | 其他列 |\n|---|---|\n| 前面 __目标文字__ 后面 | 其他内容 |'
  const f=await fixture(source)
  assert.equal(copyRange(f,selectText(f.doc,'文字')),'**文字**')
  assert.equal(copyRange(f,selectText(f.doc,'目标文字')),'__目标文字__')
  assert.equal(copyRange(f,selectContents(f,f.doc.querySelector('th'))),'**表头文字**')
  assert.equal(copyRange(f,selectContents(f,f.doc.querySelector('td'))),'前面 __目标文字__ 后面')
})

test('partial cell selections preserve nested formatting, links, code, escapes and internal spaces',async()=>{
  for(const [content,selected,expected] of [
    ['__外层 *内层目标* 结尾__','目标','__*目标*__'],
    ['前面 [目标文字](https://example.com "标题") 后面','文字','[文字](https://example.com "标题")'],
    ['前面 ``目标 ` 文字`` 后面','文字','``文字``'],
    ['甲  乙\\|丙 &amp; \\* 末尾','甲  乙|丙 & *','甲  乙\\|丙 &amp; \\*']
  ]) {
    const f=await fixture(`| 名称 | 内容 |\n|---|---|\n| 示例 | ${content} |`)
    // Entities may split DOM text nodes: select using source-visible endpoints.
    if(selected==='甲  乙|丙 & *') {
      const cell=f.doc.querySelectorAll('td')[1]
      const first=textPoint(f.doc,'甲'),last=textPoint(f.doc,'末尾')
      assert.ok(cell.contains(first.node)&&cell.contains(last.node))
      assert.equal(copyRange(f,selectPoints(f.doc,first.node,first.at,last.node,last.at-1)),expected)
    } else assert.equal(copyRange(f,selectText(f.doc,selected)),expected)
  }
})

test('touching part of a formula in one cell completes only that original formula',async()=>{
  for(const math of ['$x^2$', '$$x^2$$', '\\(x^2\\)', '\\[x^2\\]']) {
    const f=await fixture(`| 甲 | 乙 |\n|---|---|\n| 前面 ${math} 后面 | $y$ |`)
    const node=f.doc.querySelector('.katex-html .mord').firstChild
    const range=selectPoints(f.doc,node,0,node,1)
    assert.equal(copyRange(f,range),math)
  }
})

test('a whole mixed math cell keeps every original formula and intervening prose',async()=>{
  const content='$\\int_a^b f(x)\\,\\mathrm{d}x$ （$a>0$）'
  const f=await fixture(`| 基准 | 条件 |\n|---|---|\n| ${content} | $p>1$ |`)
  assert.equal(copyRange(f,selectContents(f,f.doc.querySelector('td'))),content)
})

test('identical cell text or math maps by position in forward and reverse copy events',async()=>{
  const source='| 甲 | 乙 |\n|---|---|\n| **重复** $p>1$ | __重复__ \\(p>1\\) |'
  const f=await fixture(source),ctx=fakeContext(),{host}=fakeHost([{role:'assistant',text:source}])
  startController(host,ctx,f);await tick()
  try {
    for(const reverse of [false,true]) {
      for(const occurrence of [0,1]) {
        selectText(f.doc,'重复',occurrence)
        if(reverse) {
          const s=f.doc.getSelection();s.setBaseAndExtent(s.focusNode,s.focusOffset,s.anchorNode,s.anchorOffset)
        }
        const {data}=dispatchCopy(f,{'text/plain':'old','text/html':'<b>old</b>'})
        assert.deepEqual([...data],[['text/plain',occurrence===0?'**重复**':'__重复__']])
        const math=f.doc.querySelectorAll('td .katex')[occurrence]
        selectContents(f,math)
        if(reverse) {
          const s=f.doc.getSelection();s.setBaseAndExtent(s.focusNode,s.focusOffset,s.anchorNode,s.anchorOffset)
        }
        assert.equal(dispatchCopy(f).data.get('text/plain'),occurrence===0?'$p>1$':'\\(p>1\\)')
      }
    }
    assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  } finally {ctx.dispose()}
})

test('cross-cell, cross-row and complete table selections still preserve the entire original table',async()=>{
  const source='| 列甲 | 列乙 |\r\n|:---|---:|\r\n| 第一格 | 第二格 |\r\n| 第三格 | 第四格 |'
  const f=await fixture(source)
  for(const [start,end] of [['第一格','第二格'],['第二格','第四格'],['列甲','第一格']]) {
    const a=textPoint(f.doc,start),b=textPoint(f.doc,end)
    assert.equal(copyRange(f,selectPoints(f.doc,a.node,a.at+1,b.node,b.at+2)),source)
  }
  assert.equal(copyRange(f,selectContents(f,f.doc.querySelector('table'))),source)
})

test('selection crossing the cell boundary into surrounding prose expands the touched table',async()=>{
  const table='| 甲 | 乙 |\n|---|---|\n| 单元格 | 其他格 |'
  const f=await fixture(`前文\n\n${table}\n\n后文`)
  const a=textPoint(f.doc,'前文'),b=textPoint(f.doc,'单元格'),c=textPoint(f.doc,'后文')
  assert.equal(copyRange(f,selectPoints(f.doc,a.node,a.at,b.node,b.at+1)),`前文\n\n${table}`)
  assert.equal(copyRange(f,selectPoints(f.doc,b.node,b.at+1,c.node,c.at+2)),`${table}\n\n后文`)
})
