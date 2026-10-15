import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture, fakeContext, fakeHost, tick, selectText, dispatchCopy, selectPoints, textPoint} from './helpers.js'
import {startController} from '../src/controller.js'
import {parseSource} from '../src/source-map.js'
import {alignProjection, projectMessage} from '../src/dom-adapter.js'

const source=(await readFile(new URL('./fixtures/hermes-media-images.md',import.meta.url),'utf8')).trimEnd()
const snapshots=Object.fromEntries(await Promise.all(['loading','ready','failed'].map(async state=>[state,await readFile(new URL(`./fixtures/hermes-media-images-${state}.html`,import.meta.url),'utf8')])))
async function setup(state='ready',text=source,change=()=>{}) {
  const f=await fixture(text)
  f.root.querySelector('.aui-md').outerHTML=snapshots[state]
  change(f)
  const ctx=fakeContext(),mock=fakeHost([{role:'assistant',text}])
  startController(mock.host,ctx,f);await tick()
  return {...f,...mock,ctx}
}
function selectElement(f,element){
  const range=f.doc.createRange();range.selectNodeContents(element)
  f.doc.getSelection().removeAllRanges();f.doc.getSelection().addRange(range)
}

test('upstream MEDIA image states do not prevent exact copying of surrounding prose, lists or code',async()=>{
  for(const state of ['loading','ready','failed']) {
    const f=await setup(state)
    assert.ok(alignProjection(projectMessage(f.root),parseSource(source)),state)
    for(const [text,expected] of [['前段原文','**前段原文**'],['后段原文','**后段原文**'],['另一个示例','**另一个示例**'],['example --flag','`example --flag`']]) {
      for(const reverse of [false,true]) {
        selectText(f.doc,text)
        const s=f.doc.getSelection()
        if(reverse)s.setBaseAndExtent(s.focusNode,s.focusOffset,s.anchorNode,s.anchorOffset)
        assert.deepEqual([...dispatchCopy(f,{'text/plain':'old','text/html':'old'}).data],[['text/plain',expected]],state)
      }
    }
    for(const code of f.doc.querySelectorAll('pre code')){
      selectElement(f,code)
      const expected=code.textContent.includes('中文参数')?'```bash\nexample "中文参数" \\\n  --quality high\n```':'```yaml\nexample:\n  provider: demo\n```'
      assert.equal(dispatchCopy(f).data.get('text/plain'),expected)
    }
    assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
    f.ctx.dispose()
  }
})

test('selecting an image without original target evidence fails closed, including a whole reply',async()=>{
  for(const state of ['loading','ready','failed']){
    const f=await setup(state)
    for(const element of [f.doc.querySelector('[data-slot="aui_markdown-image"]'),f.doc.querySelector('.aui-md')]){
      selectElement(f,element)
      const {data,event}=dispatchCopy(f)
      assert.ok(event.defaultPrevented)
      assert.equal(data.get('text/plain'),'previous clipboard')
      const dialog=f.doc.querySelector('[data-source-copy-dialog]')
      assert.ok(dialog)
      await tick()
      assert.equal(dialog.querySelector('textarea').value,source)
      dialog.querySelector('button').click()
    }
    f.ctx.dispose()
  }
})

test('a proven exact display URL can copy the original MEDIA directive or original media link',async()=>{
  for(const text of [source,source.replace('MEDIA:/fixtures/images/first.png','[Image: first.png](#media:%2Ffixtures%2Fimages%2Ffirst.png)')]){
    const f=await setup('ready',text,fixture=>{
      const img=fixture.doc.querySelector('img');img.setAttribute('src','/fixtures/images/first.png')
    })
    selectElement(f,f.doc.querySelector('[data-slot="aui_markdown-image"]'))
    assert.equal(dispatchCopy(f).data.get('text/plain'),text===source?'MEDIA:/fixtures/images/first.png':'[Image: first.png](#media:%2Ffixtures%2Fimages%2Ffirst.png)')
    f.ctx.dispose()
  }
})

test('same basename with different source targets cannot disambiguate otherwise identical replies',async()=>{
  const f=await fixture(source)
  f.root.querySelector('.aui-md').outerHTML=snapshots.ready
  const ctx=fakeContext(),{host}=fakeHost([{role:'assistant',text:source},{role:'assistant',text:source.replace('/fixtures/images/','/other/images/')}])
  startController(host,ctx,f);await tick()
  selectText(f.doc,'后段原文')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  ctx.dispose()
})

test('renamed, retargeted and structurally changed images are rejected rather than skipped',async()=>{
  for(const change of [
    f=>f.doc.querySelector('img').setAttribute('alt','unrelated.png'),
    f=>f.doc.querySelector('img').setAttribute('src','/other/first.png'),
    f=>f.doc.querySelector('[data-slot="aui_markdown-image"]').append(f.doc.createElement('em')),
    f=>f.doc.querySelector('[data-slot="aui_markdown-image"]').append('unexpected text')
  ]){
    const f=await setup('ready',source,change)
    selectText(f.doc,'后段原文')
    assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
    assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
    f.ctx.dispose()
  }
})

test('image failure captions split across real React text nodes still match',async()=>{
  const f=await setup('failed',source,f=>{
    for(const image of f.doc.querySelectorAll('[data-slot="aui_markdown-image"]')){
      const text=image.firstChild.textContent,button=image.querySelector('button')
      image.replaceChildren(f.doc.createTextNode("Couldn't load "),f.doc.createTextNode(text.slice(14,-2)),f.doc.createTextNode('. '),button)
    }
  })
  selectText(f.doc,'后段原文')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'**后段原文**')
  f.ctx.dispose()
})

test('literal MEDIA lines preserve original quotes, spaces, escapes and CRLF as atomic source',async()=>{
  for(const line of ['MEDIA:/fixtures/a.png','MEDIA:  "/fixtures/space dir/a.png"',"MEDIA:'/fixtures/space dir/a.png'",'MEDIA:C:\\fixtures\\a.png']){
    const text=`前面\r\n\r\n${line}\r\n\r\n后面`,f=await fixture(text),ctx=fakeContext(),{host}=fakeHost([{role:'assistant',text}])
    startController(host,ctx,f);await tick()
    selectText(f.doc,'a.png')
    assert.equal(dispatchCopy(f).data.get('text/plain'),line)
    ctx.dispose()
  }
})

test('MEDIA inside code or user text remains literal source, and unsupported media stays in fallback',()=>{
  for(const [text,role] of [['`MEDIA:/fixtures/a.png`','assistant'],['```text\nMEDIA:/fixtures/a.png\n```','assistant'],['MEDIA:/fixtures/a.png','user']]){
    assert.equal(parseSource(text,role).units.some(unit=>unit.kind==='image'),false)
  }
  assert.equal(parseSource('MEDIA:/fixtures/a.mp4').units.some(unit=>unit.kind==='image'),false)
  assert.throws(()=>parseSource('![ordinary image](/fixtures/a.png)'),/图片/)
})

test('unverified image crossing blocks copying even when both endpoints are ordinary prose',async()=>{
  const f=await setup()
  const a=textPoint(f.doc,'前段原文'),b=textPoint(f.doc,'后段原文')
  selectPoints(f.doc,a.node,a.at,b.node,b.at+4)
  assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  f.ctx.dispose()
})
