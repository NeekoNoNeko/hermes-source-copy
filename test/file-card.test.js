import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture, fakeContext, fakeHost, tick, selectText, dispatchCopy} from './helpers.js'
import {startController} from '../src/controller.js'
import {projectMessage, alignProjection} from '../src/dom-adapter.js'
import {parseSource} from '../src/source-map.js'

const source=(await readFile(new URL('./fixtures/hermes-table-file.md',import.meta.url),'utf8')).trimEnd()
const html=await readFile(new URL('./fixtures/hermes-table-file.html',import.meta.url),'utf8')
const card=await readFile(new URL('./fixtures/hermes-file-card.html',import.meta.url),'utf8')
const link=source.slice(source.indexOf('[File:'),source.indexOf('\n\n需要'))

async function setup(text=source, transform=()=>{}) {
  const f=await fixture(text)
  if(text===source) f.root.querySelector('.aui-md').outerHTML=html
  const template=f.doc.createElement('template');template.innerHTML=card
  const element=template.content.firstElementChild
  // React creates this card inside the paragraph. Replacing through DOM APIs
  // preserves that tree; HTML parsing would silently close the parent <p>.
  f.root.querySelector('a[href^="#media:"]').replaceWith(element)
  transform(element)
  const ctx=fakeContext(), {host,notices}=fakeHost([{role:'assistant',text}])
  startController(host,ctx,f);await tick()
  return {...f,ctx,notices,element}
}

test('official table and attachment DOM allow copying anywhere in the complete reply',async()=>{
  const f=await setup()
  assert.ok(alignProjection(projectMessage(f.root),parseSource(source)))
  for(const [selected,expected] of [
    ['示例专业共 3 个','**示例专业共 3 个**'],
    ['系统结构','系统结构'],
    ['仅作示例','1. **仅作示例**'],
    ['下一组数据','**下一组数据**'],
    ['15（含基地2）',source.slice(source.indexOf('| 专业代码'),source.indexOf('\n\n方向'))],
    ['汇总.md',link]
  ]) {
    selectText(f.doc,selected)
    assert.equal(dispatchCopy(f).data.get('text/plain'),expected,selected)
  }
  const range=f.doc.createRange();range.selectNodeContents(f.root.querySelector('.aui-md'))
  f.doc.getSelection().removeAllRanges();f.doc.getSelection().addRange(range)
  assert.equal(dispatchCopy(f).data.get('text/plain'),source)
  assert.ok(f.notices.every(notice=>notice.kind==='success'))
  f.ctx.dispose()
})

test('partial and reverse file-card selections copy the exact original link, never action labels',async()=>{
  const f=await setup()
  selectText(f.doc,'示例')
  // The earlier prose also contains 示例; select the verified filename span.
  const node=f.element.querySelector('span[title]').firstChild
  f.doc.getSelection().setBaseAndExtent(node,4,node,1)
  assert.equal(dispatchCopy(f).data.get('text/plain'),link)
  assert.equal(f.element.querySelectorAll('button').length,2)
  assert.equal(f.element.querySelector('span[title]').title,'/test/fixtures/示例汇总.md')
  f.ctx.dispose()
})

test('filename alone cannot prove identity; altered target, name and malformed card fail closed',async()=>{
  for(const change of [
    el=>{el.querySelector('span[title]').title='/other/示例汇总.md'},
    el=>{el.querySelector('span[title]').textContent='错误名称.md'},
    el=>{el.querySelector('button').remove()}
  ]) {
    const f=await setup(source,change)
    selectText(f.doc,'下一组数据')
    const result=dispatchCopy(f)
    assert.ok(result.event.defaultPrevented)
    assert.equal(result.data.get('text/plain'),'previous clipboard')
    assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
    f.ctx.dispose()
  }
})

test('plain media anchors are atomic source links too; unrelated normal links retain partial formatting',async()=>{
  const text='开头 [File: 示例汇总.md](#media:%2Ftest%2Ffixtures%2F%E7%A4%BA%E4%BE%8B%E6%B1%87%E6%80%BB.md) 与 [普通链接](https://example.com)'
  const f=await fixture(text),ctx=fakeContext(),{host}=fakeHost([{role:'assistant',text}])
  startController(host,ctx,f);await tick()
  selectText(f.doc,'汇总');assert.equal(dispatchCopy(f).data.get('text/plain'),link)
  selectText(f.doc,'链接');assert.equal(dispatchCopy(f).data.get('text/plain'),'[链接](https://example.com)')
  ctx.dispose()
})

test('file-card targets preserve spaces and encoding, Windows paths and file URLs, including outer bold markers',async()=>{
  for(const [target,name] of [
    ['/test/space dir/示例 汇总.md','示例 汇总.md'],
    ['C:\\fixtures\\示例 汇总.md','示例 汇总.md'],
    ['file:///test/%E7%A4%BA%E4%BE%8B%20%E6%B1%87%E6%80%BB.md','示例 汇总.md'],
    ['https://example.com/test/report.md?q=1','report.md']
  ]) {
    const text=`**[File: 原始标签](#media:${encodeURIComponent(target)})**`
    const f=await setup(text,el=>{const span=el.querySelector('span[title]');span.title=target;span.textContent=name})
    selectText(f.doc,name.slice(0,1))
    assert.equal(dispatchCopy(f).data.get('text/plain'),text)
    f.ctx.dispose()
  }
})
