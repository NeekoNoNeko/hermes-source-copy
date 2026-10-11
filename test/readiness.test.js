import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture, fakeContext, fakeHost, tick, selectText, dispatchCopy} from './helpers.js'
import {startController} from '../src/controller.js'

async function pendingFixture(source='__前段原文__ 与 **后段原文**'){
  const f=await fixture(source),ctx=fakeContext(),finish=[]
  const mock=fakeHost([],()=>new Promise((resolve,reject)=>finish.push({resolve,reject})))
  const controller=startController(mock.host,ctx,f)
  await tick()
  return {...f,...mock,ctx,controller,finish}
}

test('message completion refreshes immediately even while the initial request is still pending',async()=>{
  const f=await pendingFixture('__完成后的原文__')
  f.ctx.emit('message.delta',{session_id:'runtime-1'})
  f.ctx.emit('message.complete',{session_id:'runtime-1'})
  assert.equal(f.calls.length,2)
  f.finish[1].resolve({messages:[{role:'assistant',text:f.source}]})
  await tick()
  selectText(f.doc,'原文')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'__原文__')
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  f.finish[0].resolve({messages:[{role:'assistant',text:'过期的原文'}]})
  await tick()
  assert.equal(dispatchCopy(f).data.get('text/plain'),'__原文__')
  f.ctx.dispose()
})

test('a ready RPC cannot certify uniqueness before the full stored archive finishes',async()=>{
  const f=await fixture('**重复**'),ctx=fakeContext()
  const {host,notices}=fakeHost([{role:'assistant',text:'**重复**'}])
  let finish
  f.win.hermesDesktop={api:()=>new Promise(resolve=>{finish=resolve})}
  startController(host,ctx,f);await tick()
  selectText(f.doc,'重复')
  const copy=dispatchCopy(f)
  assert.equal(copy.data.get('text/plain'),'previous clipboard')
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  finish({messages:[{role:'assistant',text:'**重复**'},{role:'assistant',text:'__重复__'}]})
  await tick()
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  assert.ok(notices.every(n=>n.kind!=='success'))
  assert.equal(copy.data.get('text/plain'),'previous clipboard')
  ctx.dispose()
})

test('changing selection, copying elsewhere, leaving the window or ending the plugin suppresses late UI',async()=>{
  for(const action of ['selection','other-copy','blur','pointer','focus','scope','pause','unload']){
    const f=await pendingFixture()
    selectText(f.doc,'前段原文');dispatchCopy(f)
    const count=f.notices.length
    if(action==='selection') selectText(f.doc,'后段原文')
    if(action==='other-copy'){
      f.doc.getSelection().removeAllRanges()
      assert.equal(dispatchCopy(f).event.defaultPrevented,false)
    }
    if(action==='blur') f.win.dispatchEvent(new f.win.Event('blur'))
    if(action==='pointer') f.doc.body.dispatchEvent(new f.win.Event('pointerdown',{bubbles:true}))
    if(action==='focus') {const input=f.doc.createElement('input');f.doc.body.append(input);input.focus()}
    if(action==='scope') f.host.state.focusedSessionOwner.set({connectionId:'other',profile:'private'})
    if(action==='pause') f.controller.commands.toggle()
    if(action==='unload') f.ctx.dispose()
    const afterAction=f.notices.length
    assert.ok(afterAction>=count)
    f.finish[0].resolve({messages:[{role:'assistant',text:f.source}]})
    await tick()
    assert.equal(f.notices.length,afterAction,action)
    assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null,action)
    f.ctx.dispose()
  }
})

test('actual loading failure still offers source fallback with masked error details',async()=>{
  const f=await pendingFixture()
  selectText(f.doc,'前段原文');dispatchCopy(f)
  f.finish[0].reject(new Error('https://private:secret@host.invalid'))
  await tick()
  const dialog=f.doc.querySelector('[data-source-copy-dialog]')
  assert.ok(dialog)
  assert.doesNotMatch(dialog.textContent,/private:secret|host.invalid/)
  assert.ok(f.notices.every(n=>n.kind!=='success'))
  f.ctx.dispose()
})

test('explicit source command still opens immediately while loading',async()=>{
  const f=await pendingFixture()
  f.controller.commands.openRaw()
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  f.finish[0].resolve({messages:[{role:'assistant',text:f.source}]})
  await tick()
  assert.equal(f.doc.querySelector('textarea').value,f.source)
  f.ctx.dispose()
})

test('pointer down starts a fresh read before selection debounce after invalidation',async()=>{
  const f=await pendingFixture()
  f.ctx.emit('message.delta',{session_id:'runtime-1'})
  assert.equal(f.calls.length,1)
  f.root.querySelector('p').dispatchEvent(new f.win.Event('pointerdown',{bubbles:true}))
  assert.equal(f.calls.length,2)
  f.finish[1].resolve({messages:[{role:'assistant',text:f.source}]})
  await tick()
  selectText(f.doc,'后段原文')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'**后段原文**')
  f.ctx.dispose()
  f.finish[0].resolve({messages:[]})
})

test('official mixed code/table/math DOM stays selectable during cold load and copies exact source when ready',async()=>{
  const source=(await readFile(new URL('./fixtures/hermes-readiness.md',import.meta.url),'utf8')).trimEnd()
  const html=await readFile(new URL('./fixtures/hermes-readiness.html',import.meta.url),'utf8')
  const f=await pendingFixture(source)
  f.root.querySelector('.aui-md').outerHTML=html
  selectText(f.doc,'原始加粗文字')
  const cold=dispatchCopy(f)
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  f.finish[0].resolve({messages:[{role:'assistant',text:source}]})
  await tick()
  assert.equal(cold.data.get('text/plain'),'previous clipboard')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'**原始加粗文字**')
  selectText(f.doc,'目标文字')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'**目标文字**')
  const range=f.doc.createRange();range.selectNodeContents(f.root.querySelector('.aui-md'))
  f.doc.getSelection().removeAllRanges();f.doc.getSelection().addRange(range)
  assert.equal(dispatchCopy(f).data.get('text/plain'),source)
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  f.ctx.dispose()
})
