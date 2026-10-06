import { MappingError, normalizeUnits } from './source-map.js'

// Only this adapter depends on Hermes' ac28abc96c DOM. No React internals,
// synthetic composer events, or client source patches are used.
export const SELECTORS = Object.freeze({
  surface: '[data-chat-surface]',
  message: '[data-slot="aui_assistant-message-root"], [data-slot="aui_user-message-root"]',
  assistantBody: '[data-slot="aui_assistant-message-content"]',
  markdown: '.aui-md',
  userBody: '[data-slot="aui_user-message-text"]',
  excluded: '[data-slot="aui_thinking-disclosure"], [data-slot="aui_reasoning-text"], [data-slot="aui_thinking-body"], [data-conversation-scaffold], button, [role="button"], input, textarea, [contenteditable], script, style, svg, [hidden]',
  editable: 'input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], [data-source-copy-dialog]'
})
const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'TR', 'TABLE', 'HR'])

export function elementOf(node) { return node?.nodeType === 1 ? node : node?.parentElement }

export function pointCompare(doc, aNode, aOffset, bNode, bOffset) {
  const a = doc.createRange(), b = doc.createRange()
  a.setStart(aNode, aOffset); a.collapse(true)
  b.setStart(bNode, bOffset); b.collapse(true)
  return a.compareBoundaryPoints(0, b)
}

export function unitIntersects(range, unit) {
  if (unit.synthetic) return false
  const doc = range.startContainer.ownerDocument
  let node = unit.node, from = unit.from, to = unit.to
  if (unit.kind === 'math') {
    node = unit.element.parentNode
    from = Array.prototype.indexOf.call(node.childNodes, unit.element)
    to = from + 1
  }
  return pointCompare(doc, node, to, range.startContainer, range.startOffset) > 0 &&
    pointCompare(doc, node, from, range.endContainer, range.endOffset) < 0
}

export function projectMessage(root) {
  const role = root.getAttribute('data-role') || (root.matches('[data-slot="aui_user-message-root"]') ? 'user' : 'assistant')
  let bodies
  if (role === 'user') bodies = [...root.querySelectorAll(SELECTORS.userBody)]
  else {
    const content = root.querySelector(SELECTORS.assistantBody)
    bodies = content ? [...content.querySelectorAll(SELECTORS.markdown)].filter(el => !el.closest('[data-slot="aui_thinking-disclosure"], [data-slot="aui_reasoning-text"], [data-slot="aui_thinking-body"]')) : []
  }
  if (!bodies.length) throw new MappingError('当前消息正文结构不受支持')
  const units = []
  const separator = () => units.push({ kind: 'text', value: '\n', synthetic: true })
  function walk(node) {
    if (node.nodeType === 3) {
      const value = node.nodeValue || ''
      for (let i = 0; i < value.length; i++) units.push({ kind: 'text', value: value[i], node, from: i, to: i + 1 })
      return
    }
    if (node.nodeType !== 1 || node.matches(SELECTORS.excluded)) return
    if (node.classList.contains('katex')) {
      const annotation = node.querySelector('annotation[encoding="application/x-tex"]')
      if (!annotation) throw new MappingError('公式未保留可核对的 LaTeX')
      units.push({ kind: 'math', value: annotation.textContent.trim(), element: node })
      return
    }
    if (node.getAttribute('aria-hidden') === 'true') return
    if (node.matches('[data-slot="code-card"]')) {
      const code = node.querySelector('pre code, code')
      if (!code) throw new MappingError('代码卡片正文结构未知')
      separator(); walk(code); separator()
      return
    }
    if (node.tagName === 'BR') { separator(); return }
    if (blockTags.has(node.tagName) || node.classList.contains('katex-display')) separator()
    node.childNodes.forEach(walk)
    if (blockTags.has(node.tagName) || node.classList.contains('katex-display')) separator()
  }
  for (const body of bodies) { separator(); walk(body); separator() }
  const tokens = normalizeUnits(units)
  return { root, bodies, role, tokens, signature: JSON.stringify(tokens.map(t => t.key)), messageId: root.getAttribute('data-message-id') }
}

export function describeSelection(doc) {
  const selection = doc.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0).cloneRange()
  const start = elementOf(range.startContainer), end = elementOf(range.endContainer)
  if (start?.closest(SELECTORS.editable) || end?.closest(SELECTORS.editable)) return null
  const startSurface = start?.closest(SELECTORS.surface), endSurface = end?.closest(SELECTORS.surface)
  if (!startSurface && !endSurface) return null
  if (!startSurface || startSurface !== endSurface) return { range, surface: startSurface || endSurface, error: '选区跨越了不同聊天或非正文区域' }
  if (startSurface.hasAttribute('data-session-switching')) return { range, surface: startSurface, error: '聊天正在切换，请稍后复制' }
  const roots = [...startSurface.querySelectorAll(SELECTORS.message)].filter(el => range.intersectsNode(el))
  // A selection only in the composer, thinking, timestamps, or controls must
  // pass through; it is not an unsupported *body* selection.
  if (!roots.length) return null
  const selected = []
  for (const root of roots) {
    try {
      const projection = projectMessage(root)
      if (!projection.bodies.some(b => range.intersectsNode(b))) continue
      if (projection.tokens.some(t => t.members.some(u => unitIntersects(range, u)))) selected.push(projection)
    } catch (error) {
      if (start?.closest(SELECTORS.message) === root || end?.closest(SELECTORS.message) === root) return { range, surface: startSurface, error: error.message }
    }
  }
  if (!selected.length) return null
  return { range, surface: startSurface, selected }
}

export function selectedTokenSpan(projection, range) {
  const selected = []
  projection.tokens.forEach((token, index) => {
    if (token.members.some(u => unitIntersects(range, u))) selected.push(index)
  })
  if (!selected.length) throw new MappingError('选区没有可定位的正文')
  const fullCodeSpans = []
  for (const body of projection.bodies) {
    for (const code of body.querySelectorAll('pre code, [data-slot="code-card"] code')) {
      if (pointCompare(range.startContainer.ownerDocument, range.startContainer, range.startOffset, code, 0) > 0 ||
          pointCompare(range.startContainer.ownerDocument, range.endContainer, range.endOffset, code, code.childNodes.length) < 0) continue
      const indices = projection.tokens.flatMap((token, index) => token.members.some(u => u.node && code.contains(u.node)) ? [index] : [])
      if (indices.length) fullCodeSpans.push([indices[0], indices.at(-1) + 1])
    }
  }
  return [selected[0], selected.at(-1) + 1, { fullCodeSpans }]
}

// Prove that all selected rows refer to one monotonically ordered history.
// Multiple valid embeddings are ambiguous, including repeated identical text.
export function matchHistory(visible, history) {
  const candidates = visible.map(p => {
    const idStamp = p.messageId?.match(/^([\d.]+)-\d+-(?:user|assistant)$/)?.[1]
    return history.flatMap((h, index) => {
      if (h.role !== p.role || h.model?.signature !== p.signature) return []
      if (idStamp && h.timestamp && Number(idStamp) !== Number(h.timestamp)) return []
      return [index]
    })
  })
  const forward = candidates.map(() => new Set())
  for (let row = 0; row < candidates.length; row++) {
    const minimum = row ? forward[row - 1].values().next().value ?? Infinity : -Infinity
    for (const index of candidates[row]) {
      if (minimum < index) forward[row].add(index)
    }
  }
  const backward = candidates.map(() => new Set())
  for (let row = candidates.length - 1; row >= 0; row--) {
    const next = row < candidates.length - 1 ? backward[row + 1] : null
    let maximum = next ? -Infinity : Infinity
    if (next) for (const index of next) maximum = index
    for (const index of candidates[row]) {
      if (index < maximum) backward[row].add(index)
    }
  }
  return candidates.map((_, row) => {
    const valid = [...forward[row]].filter(index => backward[row].has(index))
    return valid.length === 1 ? history[valid[0]] : null
  })
}
