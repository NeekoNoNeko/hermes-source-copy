import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { decodeHTMLStrict } from 'entities'

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
const blocks = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'code', 'math', 'tableCell', 'tableRow', 'table', 'thematicBreak'])
const inlineWrappers = new Set(['strong', 'emphasis', 'delete', 'link', 'linkReference', 'inlineCode'])
const escapedPunctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

export class MappingError extends Error {}

// Normalize only delimiters, keeping UTF-16 offsets unchanged. Code and HTML
// are excluded by the first parse. Never serialize this normalized string.
export function normalizeMath(source) {
  const tree = parser.parse(source)
  const chars = source.split('')
  function walk(node) {
    if (node.type === 'text') {
      const start = node.position.start.offset
      const raw = source.slice(start, node.position.end.offset)
      const re = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g
      for (const m of raw.matchAll(re)) {
        const at = start + m.index
        let escapes = 0
        for (let i = at - 1; i >= 0 && source[i] === '\\'; i--) escapes++
        if (escapes % 2) continue
        const close = at + m[0].length - 2
        if (m[1] !== undefined) {
          chars[at] = '$'; chars[at + 1] = ' '
          chars[close] = ' '; chars[close + 1] = '$'
        } else {
          chars[at] = '$'; chars[at + 1] = '$'
          chars[close] = '$'; chars[close + 1] = '$'
        }
      }
    } else if (node.children) node.children.forEach(walk)
  }
  walk(tree)
  return chars.join('')
}

export function normalizeUnits(units) {
  const result = []
  for (const unit of units) {
    if (unit.kind === 'text' && /\s/u.test(unit.value)) {
      const prev = result.at(-1)
      if (prev?.key === ' ') {
        prev.members.push(unit)
        continue
      }
      result.push({ key: ' ', members: [unit] })
    } else result.push({ key: unit.kind === 'math' ? `math:${unit.value.trim()}` : unit.kind === 'attachment' ? `attachment:${unit.value}` : `text:${unit.value}`, members: [unit] })
  }
  while (result[0]?.key === ' ') result.shift()
  while (result.at(-1)?.key === ' ') result.pop()
  return result
}

function decodedUnits(source, start, end, value, ancestors, literal = false, inline = false) {
  value = value.replace(/\r\n?/g, '\n')
  const units = []
  let cursor = start
  while (cursor < end) {
    const at = cursor
    let decoded = source[cursor++]
    if (decoded === '\r') {
      if (source[cursor] === '\n') cursor++
      decoded = inline ? ' ' : '\n'
    } else if (!literal && decoded === '\\' && escapedPunctuation.test(source[cursor] || '')) {
      decoded = source[cursor++]
    } else if (!literal && decoded === '&') {
      const entity = source.slice(at, end).match(/^&(?:#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/)
      if (entity) {
        const decodedEntity = decodeHTMLStrict(entity[0])
        if (decodedEntity !== entity[0]) {
          decoded = decodedEntity
          cursor = at + entity[0].length
        }
      }
    }
    if (inline && decoded === '\n') decoded = ' '
    for (let j = 0; j < decoded.length; j++) units.push({ kind: 'text', value: decoded[j], start: at, end: cursor, ancestors })
  }
  if (units.map(u => u.value).join('') === value) return units
  // mdast removes quote/list continuation prefixes. Allow skipping only
  // whitespace / quote marks at a source line boundary, never prose.
  const matched = []
  let index = 0
  for (let v = 0; v < value.length; v++) {
    if (units[index]?.value !== value[v] && ancestors.some(n => ['blockquote', 'listItem', 'code'].includes(n.type))) {
      const previous = units[index - 1]
      if (previous?.value === '\n') {
        while (units[index] && /[ >\t]/.test(units[index].value) && units[index].value !== value[v]) index++
      }
    }
    if (units[index]?.value !== value[v]) throw new MappingError('消息含有尚不支持的源码变换')
    matched.push(units[index++])
  }
  if (units.slice(index).some(u => !/\s/.test(u.value))) throw new MappingError('源码位置不匹配')
  return matched
}

function codeBody(source, node) {
  const start = node.position.start.offset
  const end = node.position.end.offset
  const raw = source.slice(start, end)
  if (node.type === 'inlineCode') {
    const fence = raw.match(/^`+/)?.[0]
    if (!fence) throw new MappingError('行内代码边界未知')
    let from = start + fence.length
    let to = end - fence.length
    let body = source.slice(from, to).replace(/\r\n?|\n/g, ' ')
    if (/^ .* $/.test(body) && /[^ ]/.test(body)) { from++; to--; body = body.slice(1, -1) }
    return { from, to, body, literal: true }
  }
  const firstLine = raw.match(/^[^\r\n]*\r?\n/)
  const opener = raw.match(/^\s*(`{3,}|~{3,})/)
  if (!firstLine || !opener) throw new MappingError('缩进代码请在源码窗口复制')
  const close = raw.match(/(?:\r?\n)[ \t]*(?:`{3,}|~{3,})[ \t]*$/)
  if (!close) throw new MappingError('代码块尚未闭合')
  return { from: start + firstLine[0].length, to: start + close.index, body: node.value, literal: true }
}

export function parseSource(source, role = 'assistant') {
  if (typeof source !== 'string' || source.length > 200_000) throw new MappingError('消息过长或原文不可用')
  const normalized = role === 'user' ? source : normalizeMath(source)
  const tree = parser.parse(normalized)
  const units = []
  const wrappers = []
  const definitions = new Map()
  function collect(node) {
    if (node.type === 'definition') definitions.set(node.identifier, node)
    node.children?.forEach(collect)
  }
  collect(tree)
  const separator = () => units.push({ kind: 'text', value: '\n', start: null, end: null, ancestors: [] })
  function visit(node, ancestors) {
    if (!node.position) return
    const path = [...ancestors, node]
    if (blocks.has(node.type)) separator()
    if (node.type === 'definition') return
    if (role === 'user' && !['root', 'text', 'inlineCode', 'code'].includes(node.type)) {
      // User bubbles deliberately display almost all Markdown literally.
      // Special code-only user projection is built below instead.
      return
    }
    if (node.type === 'text') {
      units.push(...decodedUnits(source, node.position.start.offset, node.position.end.offset, node.value, path))
    } else if (node.type === 'link' && node.url.startsWith('#media:')) {
      let target
      try { target = decodeURIComponent(node.url.slice(7)) } catch { throw new MappingError('文件链接编码不受支持') }
      units.push({ kind: 'attachment', value: target, start: node.position.start.offset, end: node.position.end.offset, ancestors: path })
    } else if (node.type === 'inlineMath' || node.type === 'math') {
      const raw = source.slice(node.position.start.offset, node.position.end.offset)
      const slash = raw.startsWith('\\(') || raw.startsWith('\\[')
      const count = slash ? 2 : raw.match(/^\$+/)?.[0].length
      if (!count) throw new MappingError('公式边界未知')
      const expression = raw.slice(count, -count).trim()
      units.push({ kind: 'math', value: expression, start: node.position.start.offset, end: node.position.end.offset, ancestors: path })
    } else if (node.type === 'inlineCode' || node.type === 'code') {
      const body = codeBody(source, node)
      const value = node.type === 'inlineCode' ? body.body : node.value
      const mapped = decodedUnits(source, body.from, body.to, value, path, true, node.type === 'inlineCode')
      // CommonMark turns newlines inside inline code into spaces.
      if (node.type === 'inlineCode') mapped.forEach(u => { if (u.value === '\n') u.value = ' ' })
      units.push(...mapped)
      wrappers.push({ node, from: body.from, to: body.to })
    } else if (node.type === 'html' || node.type === 'image' || node.type === 'imageReference' || node.type === 'footnoteReference') {
      throw new MappingError('HTML、图片或脚注请在源码窗口复制')
    } else if (node.type === 'break') {
      units.push({ kind: 'text', value: '\n', start: node.position.start.offset, end: node.position.end.offset, ancestors: path })
    } else {
      if ((inlineWrappers.has(node.type) || node.type === 'heading') && node.children?.length) {
        wrappers.push({ node, from: node.children[0].position.start.offset, to: node.children.at(-1).position.end.offset })
      }
      node.children?.forEach(child => visit(child, path))
    }
    if (blocks.has(node.type)) separator()
  }
  if (role === 'user') {
    // Mirror UserMessageText: only fenced and inline code are rendered.
    const codeNodes = []
    function codeWalk(node) {
      if (node.type === 'code' || node.type === 'inlineCode') codeNodes.push(node)
      else node.children?.forEach(codeWalk)
    }
    codeWalk(tree)
    let at = 0
    for (const node of codeNodes) {
      const start = node.position.start.offset
      for (let i = at; i < start; i++) units.push({ kind: 'text', value: source[i], start: i, end: i + 1, ancestors: [] })
      visit(node, [])
      at = node.position.end.offset
    }
    for (let i = at; i < source.length; i++) units.push({ kind: 'text', value: source[i], start: i, end: i + 1, ancestors: [] })
  } else visit(tree, [])
  const tokens = normalizeUnits(units)
  return { source, tree, units, tokens, wrappers, definitions, role, signature: JSON.stringify(tokens.map(t => t.key)) }
}

export function extractSource(model, fromToken, toToken, { fullCodeSpans = [] } = {}) {
  if (fromToken < 0 || toToken > model.tokens.length || fromToken >= toToken) throw new MappingError('选区没有可复制的正文')
  const members = model.tokens.slice(fromToken, toToken).flatMap(t => t.members).filter(u => u.start !== null)
  if (!members.length) throw new MappingError('选区没有对应源码')
  let start = members[0].start
  let end = members.at(-1).end
  const path = [...new Set(members.flatMap(u => u.ancestors))]
  for (const node of path.filter(n => n.type === 'code')) {
    const indices = model.tokens.flatMap((token, index) => token.members.some(u => u.ancestors?.includes(node)) ? [index] : [])
    if (indices.length && fullCodeSpans.some(([from, to]) => from <= indices[0] && to > indices.at(-1))) {
      start = Math.min(start, node.position.start.offset)
      end = Math.max(end, node.position.end.offset)
    }
  }
  const table = path.find(n => n.type === 'table')
  if (table) {
    start = Math.min(start, table.position.start.offset)
    end = Math.max(end, table.position.end.offset)
  }
  // Structural prefixes (headings/list items/quotes) are source slices,
  // not canonical Markdown. Take the exact prefix of each touched ancestor.
  const structural = path.filter(n => ['listItem', 'blockquote'].includes(n.type))
  let prefix = ''
  for (const node of structural.sort((a, b) => a.position.start.offset - b.position.start.offset)) {
    const first = node.children?.[0]
    let prefixEnd = first?.position.start.offset
    if (prefixEnd > node.position.start.offset && start >= prefixEnd && start < node.position.end.offset) {
      const candidate = model.source.slice(node.position.start.offset, prefixEnd)
      if (node.position.start.offset < start) prefix += candidate
    }
  }
  let result = model.source.slice(start, end)
  const touched = new Set(path)
  const touchedWrappers = model.wrappers.filter(w => touched.has(w.node))
  const opening = touchedWrappers.filter(w => start >= w.from && start < w.to)
    .sort((a, b) => a.node.position.start.offset - b.node.position.start.offset)
    .map(w => model.source.slice(w.node.position.start.offset, w.from)).join('')
  const closing = touchedWrappers.filter(w => end > w.from && end <= w.to)
    .sort((a, b) => a.node.position.end.offset - b.node.position.end.offset)
    .map(w => model.source.slice(w.to, w.node.position.end.offset)).join('')
  result = opening + result + closing
  const refs = path.filter(n => n.type === 'linkReference').map(n => model.definitions.get(n.identifier)).filter(Boolean)
  if (refs.length) result += '\n\n' + [...new Set(refs)].map(n => model.source.slice(n.position.start.offset, n.position.end.offset)).join('\n')
  return prefix + result
}
