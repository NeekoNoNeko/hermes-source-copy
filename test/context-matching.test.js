import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture, fakeContext, fakeHost, tick, dispatchCopy, selectPoints} from './helpers.js'
import {startController} from '../src/controller.js'
import {matchHistory} from '../src/dom-adapter.js'
import {parseSource} from '../src/source-map.js'

const source=(await readFile(new URL('./fixtures/hermes-context.md',import.meta.url),'utf8')).trimEnd()
const html=await readFile(new URL('./fixtures/hermes-context.html',import.meta.url),'utf8')
async function setup(visible,history){
  const f=await fixture(visible[0]),roots=[f.root]
  for(const text of visible.slice(1)){
    const next=await fixture(text),root=f.doc.importNode(next.root,true)
    f.root.parentElement.append(root);roots.push(root)
  }
  const ctx=fakeContext(),{host}=fakeHost(history.map(text=>({role:'assistant',text})))
  startController(host,ctx,f);await tick()
  return {...f,roots,ctx}
}
function select(f,root,text,reverse=false){
  const walker=f.doc.createTreeWalker(root.querySelector('.aui-md'),4)
  let node
  while((node=walker.nextNode())){
    if(node.parentElement.closest('.katex,button'))continue
    const at=node.nodeValue.indexOf(text)
    if(at<0)continue
    selectPoints(f.doc,node,at,node,at+text.length)
    if(reverse)f.doc.getSelection().setBaseAndExtent(node,at+text.length,node,at)
    return node
  }
  assert.fail('Missing selected text')
}
function selectRoot(f,root){
  const range=f.doc.createRange();range.selectNodeContents(root.querySelector('.aui-md'))
  f.doc.getSelection().removeAllRanges();f.doc.getSelection().addRange(range)
}

test('an unrelated duplicate display root cannot poison independently unique complete bodies',()=>{
  const history=['**旧回复**','__唯一回复__','最新回复'].map(text=>({role:'assistant',text,model:parseSource(text)}))
  const visible=[history[0],history[0],history[1],history[2]].map(row=>({role:'assistant',signature:row.model.signature}))
  assert.deepEqual(matchHistory(visible,history),[history[0],history[0],history[1],history[2]])
})

test('inconsistent surrounding order cannot choose one of several complete source candidates',()=>{
  const history=['锚点','**重复**','__重复__'].map(text=>({role:'assistant',text,model:parseSource(text)}))
  const visible=['锚点','锚点','重复'].map(text=>({role:'assistant',signature:parseSource(text).signature}))
  assert.deepEqual(matchHistory(visible,history),[history[0],history[0],null])
})

test('duplicate old context does not block any selection in an upstream mixed reply',async()=>{
  const f=await setup(['旧上下文','旧上下文',source,'新回复'],['旧上下文',source,'新回复'])
  const root=f.roots[2];root.querySelector('.aui-md').outerHTML=html
  for(const reverse of [false,true]){
    for(const [text,expected] of [['示例正文','**示例正文**'],['目标文字','**目标文字**'],['$$','`$$`'],['公式块','公式块']]){
      select(f,root,text,reverse)
      assert.deepEqual([...dispatchCopy(f,{'text/plain':'old','text/html':'old'}).data],[['text/plain',expected]])
    }
  }
  selectRoot(f,root)
  assert.equal(dispatchCopy(f).data.get('text/plain'),source)
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  f.ctx.dispose()
})

test('two display roots reusing one source row cannot be copied together',async()=>{
  const f=await setup(['**重复显示**','**重复显示**'],['**重复显示**'])
  const a=select(f,f.roots[0],'重复显示'),b=f.roots[1].querySelector('strong').firstChild
  selectPoints(f.doc,a,0,b,b.length)
  assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  f.ctx.dispose()
})

test('independent unique replies with inverted history order copy individually but not across replies',async()=>{
  for(const reverse of [false,true]){
    const f=await setup(['**显示甲**','__显示乙__'],['__显示乙__','**显示甲**'])
    select(f,f.roots[0],'显示甲');assert.equal(dispatchCopy(f).data.get('text/plain'),'**显示甲**')
    select(f,f.roots[1],'显示乙');assert.equal(dispatchCopy(f).data.get('text/plain'),'__显示乙__')
    const a=f.roots[0].querySelector('strong').firstChild,b=f.roots[1].querySelector('strong').firstChild
    selectPoints(f.doc,a,0,b,b.length)
    if(reverse)f.doc.getSelection().setBaseAndExtent(b,b.length,a,0)
    assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
    assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
    f.ctx.dispose()
  }
})

test('valid selected reply order remains copyable despite unrelated duplicated context',async()=>{
  const f=await setup(['旧上下文','旧上下文','**甲回复**','__乙回复__'],['旧上下文','**甲回复**','__乙回复__'])
  const a=f.roots[2].querySelector('strong').firstChild,b=f.roots[3].querySelector('strong').firstChild
  selectPoints(f.doc,a,0,b,b.length)
  assert.equal(dispatchCopy(f).data.get('text/plain'),'**甲回复**\n\n__乙回复__')
  assert.equal(f.doc.querySelector('[data-source-copy-dialog]'),null)
  f.ctx.dispose()
})

test('a selected duplicate source body remains blocked when unrelated context is inconsistent',async()=>{
  const f=await setup(['锚点','锚点','**重复**'],['锚点','**重复**','__重复__'])
  select(f,f.roots[2],'重复')
  assert.equal(dispatchCopy(f).data.get('text/plain'),'previous clipboard')
  assert.ok(f.doc.querySelector('[data-source-copy-dialog]'))
  f.ctx.dispose()
})
