import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture, fakeContext, fakeHost, tick, selectText, dispatchCopy} from './helpers.js'
import {startController} from '../src/controller.js'
import {parseSource} from '../src/source-map.js'
import {mediaDirectives} from '../src/media-source.js'
import {alignProjection, projectMessage} from '../src/dom-adapter.js'

const source=(await readFile(new URL('./fixtures/hermes-media-file.md',import.meta.url),'utf8')).trimEnd()
const html=await readFile(new URL('./fixtures/hermes-media-file.html',import.meta.url),'utf8')
async function setup(text=source,change=()=>{}){
  const f=await fixture(text)
  if(text===source) f.root.querySelector('.aui-md').outerHTML=html
  change(f)
  const ctx=fakeContext(),mock=fakeHost([{role:'assistant',text}])
  startController(mock.host,ctx,f);await tick()
  return {...f,...mock,ctx}
}
function selectContents(f,el,reverse=false){
  const range=f.doc.createRange();range.selectNodeContents(el)
  const s=f.doc.getSelection();s.removeAllRanges();s.addRange(range)
  if(reverse)s.setBaseAndExtent(s.focusNode,s.focusOffset,s.anchorNode,s.anchorOffset)
}
function cardFixture(f,target){
  const template=f.doc.createElement('template');template.innerHTML=html
  const name=template.content.querySelector('span[title].truncate.flex-1'),card=name.parentElement
  name.title=target
  // The supplied cases use filesystem basenames; the path itself must match.
  name.textContent=target.split(/[\\/]/).filter(Boolean).at(-1)
  return card
}

test('upstream script MEDIA card permits exact surrounding prose, code, table cell and whole reply copies',async()=>{
  const f=await setup()
  assert.ok(alignProjection(projectMessage(f.root),parseSource(source)))
  for(const [text,expected] of [['前段原文','**前段原文**'],['后段原文','**后段原文**'],['author@example.com','`author@example.com`'],['example.com:993 (TLS)','example.com:993 (TLS)']]){
    selectText(f.doc,text)
    assert.deepEqual([...dispatchCopy(f,{'text/plain':'old','text/html':'old'}).data],[['text/plain',expected]])
  }
  selectContents(f,f.doc.querySelector('pre code'))
  assert.equal(dispatchCopy(f).data.get('text/plain'),'```bash\nexample --help\n```')
  selectContents(f,f.doc.querySelector('.aui-md'))
  assert.equal(dispatchCopy(f).data.get('text/plain'),source)
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  f.ctx.dispose()
})

test('partial and reverse card selections return the complete original MEDIA directive',async()=>{
  const f=await setup(),node=f.doc.querySelector('span[title].truncate.flex-1').firstChild
  for(const reverse of [false,true]){
    f.doc.getSelection().setBaseAndExtent(node,reverse?7:1,node,reverse?1:7)
    assert.equal(dispatchCopy(f).data.get('text/plain'),'MEDIA:/fixtures/scripts/example.sh')
  }
  f.ctx.dispose()
})

test('file directives retain their original quotes, whitespace, CRLF and distinct ordered targets',async()=>{
  const lines=['MEDIA:  "/fixtures/space dir/example.sh"',"MEDIA:'/fixtures/a.md'",'MEDIA:/fixtures/report.pdf','MEDIA:C:\\fixtures\\data.json','MEDIA:/fixtures/.env','MEDIA:/fixtures/no-extension']
  const text='前文\r\n\r\n'+lines.join('\r\n')+'\r\n\r\n后文'
  const deliveries=mediaDirectives(text)
  assert.equal(deliveries.length,lines.length)
  const f=await setup(text,f=>{
    const p=[...f.doc.querySelectorAll('p')].find(p=>p.textContent.startsWith('MEDIA:'))
    p.replaceChildren(...deliveries.flatMap((delivery,index)=>[...(index?[f.doc.createTextNode('\n')]:[]),cardFixture(f,delivery.target)]))
  })
  for(const [index,card] of [...f.doc.querySelectorAll('span[title].truncate.flex-1')].entries()){
    selectContents(f,card)
    assert.equal(dispatchCopy(f).data.get('text/plain'),lines[index])
  }
  selectContents(f,f.doc.querySelector('.aui-md'),true)
  assert.equal(dispatchCopy(f).data.get('text/plain'),text)
  f.ctx.dispose()
})

test('a modified target with the same basename, label or structure cannot certify a file directive',async()=>{
  for(const change of [
    f=>f.doc.querySelector('span[title].truncate.flex-1').title='/other/example.sh',
    f=>f.doc.querySelector('span[title].truncate.flex-1').textContent='other.sh',
    f=>f.doc.querySelector('span[title].truncate.flex-1').parentElement.querySelector('button').remove()
  ]){
    const f=await setup(source,change);selectText(f.doc,'后段原文')
    assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
    assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
    f.ctx.dispose()
  }
})

test('equivalent visible file links and MEDIA directives remain ambiguous across separate history rows',async()=>{
  const f=await fixture(source),ctx=fakeContext()
  f.root.querySelector('.aui-md').outerHTML=html
  const alternate=source.replace('MEDIA:/fixtures/scripts/example.sh','[File: script](#media:%2Ffixtures%2Fscripts%2Fexample.sh)')
  const {host}=fakeHost([{role:'assistant',text:source},{role:'assistant',text:alternate}])
  startController(host,ctx,f);await tick();selectText(f.doc,'前段原文')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  ctx.dispose()
})

test('literal file directives also copy exact source while code and user messages remain literal',async()=>{
  const text='前文\n\nMEDIA: "/fixtures/example.sh"\n\n后文',f=await setup(text)
  selectText(f.doc,'example.sh')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'MEDIA: "/fixtures/example.sh"')
  f.ctx.dispose()
  for(const [text,role] of [['`MEDIA:/fixtures/example.sh`','assistant'],['```bash\nMEDIA:/fixtures/example.sh\n```','assistant'],['MEDIA:/fixtures/example.sh','user']]){
    assert.equal(parseSource(text,role).units.some(unit=>unit.mediaDirective),false)
  }
})

test('copying a script card reads only transcript routes and never invokes file actions or async clipboard writes',async()=>{
  const f=await fixture(source),ctx=fakeContext(),{host}=fakeHost([{role:'assistant',text:source}]),requests=[]
  f.root.querySelector('.aui-md').outerHTML=html
  f.win.hermesDesktop={api:async request=>{requests.push(request);assert.match(request.path,/^\/api\/sessions\/stored-1\/messages\?/);return {messages:[{role:'assistant',text:source}]}},readFileDataUrl(){assert.fail('file read')},openExternal(){assert.fail('file action')}}
  ctx.os.writeClipboard=async()=>assert.fail('async clipboard write')
  for(const button of f.doc.querySelectorAll('button'))button.addEventListener('click',()=>assert.fail('card action'))
  startController(host,ctx,f);await tick()
  selectContents(f,f.doc.querySelector('span[title].truncate.flex-1'))
  assert.equal(dispatchCopy(f).data.get('text/plain'),'MEDIA:/fixtures/scripts/example.sh')
  assert.equal(requests.length,1)
  ctx.dispose()
})
