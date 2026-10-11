import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture, selectText, selectPoints, textPoint, copyRange, fakeContext, fakeHost, tick, dispatchCopy} from './helpers.js'
import {startController} from '../src/controller.js'

test('partial ordered-item selections never gain a number, even at the beginning of its body',async()=>{
  for(const [source,selected,expected] of [
    ['3. 给示例加一张图（开头、中间、目标文字 三面板）','目标文字','目标文字'],
    ['3. 给示例加一张图（开头、中间、目标文字 三面板）','给示例','给示例'],
    ['003) 前面 __目标文字__ 后面','文字','__文字__'],
    ['3. 前面 [目标文字](https://example.com) 后面','文字','[文字](https://example.com)'],
    ['3. 前面 `目标文字` 后面','文字','`文字`'],
    ['3. 第一行\n   第二行目标文字\n\n   后续段落','目标文字','目标文字'],
    ['1. 外层文字\n   3. 内层目标文字结尾','目标文字','目标文字'],
    ['> 3. 前面目标文字后面','目标文字','> 目标文字']
  ]) {
    const f=await fixture(source)
    assert.equal(copyRange(f,selectText(f.doc,selected)),expected,source)
  }
})

test('complete ordered items retain their exact markers, spacing and inline syntax',async()=>{
  for(const [source,selected] of [
    ['3. 完整文字','完整文字'],
    ['003)  __完整文字__','完整文字'],
    ['3. 前面\n   后面','前面']
  ]) {
    const f=await fixture(source),range=f.doc.createRange()
    range.selectNodeContents(f.doc.querySelector('li'))
    assert.equal(copyRange(f,range),source,selected)
  }
})

test('cross-item selection preserves original first and subsequent numbers and CRLF',async()=>{
  const source='3) 第一项结尾\r\n4) 第二项开头'
  const f=await fixture(source),first=textPoint(f.doc,'结尾'),last=textPoint(f.doc,'第二项')
  const range=selectPoints(f.doc,first.node,first.at,last.node,last.at+3)
  assert.equal(copyRange(f,range),'3) 结尾\r\n4) 第二项')
})

test('literal numbers and escaped markers inside selected prose are never stripped',async()=>{
  for(const [source,selected,expected] of [
    ['3. 前面编号 3. 后面','3.','3.'],
    ['3\\. 普通段落','3.','3\\.'],
    ['3. 前面编号 `3. 代码` 后面','3. 代码','`3. 代码`']
  ]) {
    const f=await fixture(source)
    assert.equal(copyRange(f,selectText(f.doc,selected)),expected)
  }
})

test('touching a formula in the middle of an ordered item completes only the formula',async()=>{
  const f=await fixture('3. 前面 $x^2$ 后面')
  const range=f.doc.createRange();range.selectNode(f.doc.querySelector('.katex'))
  assert.equal(copyRange(f,range),'$x^2$')
})

test('forward and reverse Ctrl+C of a repeated phrase use the selected source spelling without a number',async()=>{
  const source='3. 前面 **相同文字** 中间 __相同文字__ 后面'
  const f=await fixture(source),ctx=fakeContext(),{host}=fakeHost([{role:'assistant',text:source}])
  startController(host,ctx,f);await tick()
  try {
    for(const reverse of [false,true]) {
      selectText(f.doc,'相同文字',1)
      const selection=f.doc.getSelection()
      if(reverse)selection.setBaseAndExtent(selection.focusNode,selection.focusOffset,selection.anchorNode,selection.anchorOffset)
      const {data,event}=dispatchCopy(f,{'text/plain':'previous','text/html':'<b>wrong</b>'})
      assert.ok(event.defaultPrevented)
      assert.deepEqual([...data],[['text/plain','__相同文字__']])
    }
  } finally {ctx.dispose()}
})
