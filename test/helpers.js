import { JSDOM } from 'jsdom'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { normalizeMath, parseSource, extractSource } from '../src/source-map.js'
import { projectMessage, selectedTokenSpan } from '../src/dom-adapter.js'

export async function fixture(source) {
  const html = String(await unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype).use(rehypeKatex).use(rehypeStringify).process(normalizeMath(source)))
  const dom = new JSDOM('<!doctype html><body><div data-chat-surface data-composer-target="main"><div data-slot="aui_assistant-message-root" data-role="assistant"><div data-slot="aui_assistant-message-content"><div class="aui-md"></div></div></div></div></body>', { url: 'https://hermes.invalid' })
  const doc = dom.window.document
  doc.querySelector('.aui-md').innerHTML = html
  return { dom, doc, win: dom.window, root: doc.querySelector('[data-role="assistant"]'), source }
}

export function textPoint(doc, text, occurrence = 0) {
  const walker = doc.createTreeWalker(doc.querySelector('.aui-md'), 4)
  let node
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('.katex, button')) continue
    const at = node.nodeValue.indexOf(text)
    if (at >= 0 && occurrence-- === 0) return { node, at }
  }
  throw new Error(`Text point not found: ${text}`)
}

export function selectText(doc, text, occurrence = 0) {
  const { node, at } = textPoint(doc, text, occurrence)
  return selectPoints(doc, node, at, node, at + text.length)
}

export function selectPoints(doc, startNode, start, endNode, end) {
  const range = doc.createRange()
  range.setStart(startNode, start); range.setEnd(endNode, end)
  const selection = doc.getSelection()
  selection.removeAllRanges(); selection.addRange(range)
  return range
}

export function copyRange(f, range) {
  const model = parseSource(f.source)
  const projection = projectMessage(f.root)
  if (model.signature !== projection.signature) throw new Error(`Signature mismatch\n${model.signature}\n${projection.signature}`)
  return extractSource(model, ...selectedTokenSpan(projection, range))
}

export function atom(value) {
  const subscribers = new Set()
  return { get: () => value, set(next) { value = next; subscribers.forEach(fn => fn(next)) }, listen(fn) { subscribers.add(fn); return () => subscribers.delete(fn) }, get count() { return subscribers.size } }
}

export function fakeHost(messages, requestOverride) {
  const notices = []
  const calls = []
  const host = {
    state: {
      activeSessionId: atom('runtime-1'),
      focusedSessionId: atom('runtime-1'), focusedStoredSessionId: atom('stored-1'),
      focusedSessionOwner: atom({ connectionId: 'local', profile: 'default' }), gateway: atom('open')
    },
    notify(notice) { notices.push(notice) },
    async requestProfile(...args) { calls.push(args); return requestOverride ? requestOverride(...args) : { messages } }
  }
  return { host, notices, calls }
}

export function fakeContext() {
  const dispose = []
  const events = new Map()
  const storage = new Map()
  return {
    storage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) },
    os: { writeClipboard: async () => true },
    addEventListener(target, type, fn, options) { target.addEventListener(type, fn, options); const off = () => target.removeEventListener(type, fn, options); dispose.push(off); return off },
    setTimeout(fn, ms) { const id = setTimeout(fn, ms); const off = () => clearTimeout(id); dispose.push(off); return off },
    onEvent(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); const off = () => events.get(type).delete(fn); dispose.push(off); return off },
    onDispose(fn) { dispose.push(fn) },
    emit(type, payload = {}) { events.get(type)?.forEach(fn => fn({ type, payload })) },
    dispose() { dispose.splice(0).reverse().forEach(fn => fn()) }
  }
}

export function dispatchCopy(f, initial = { 'text/plain': 'previous clipboard' }) {
  const data = new Map(Object.entries(initial))
  const event = new f.win.Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { clearData: () => data.clear(), setData: (kind, value) => data.set(kind, value), getData: kind => data.get(kind) || '' } })
  const target = f.doc.getSelection()?.anchorNode?.parentElement || f.doc.body
  target.dispatchEvent(event)
  return { event, data }
}

export const tick = () => new Promise(resolve => setTimeout(resolve, 0))
