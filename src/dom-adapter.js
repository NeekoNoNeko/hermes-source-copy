import { MappingError, normalizeUnits, parseSource } from './source-map.js'

// Only this adapter depends on Hermes' ac28abc96c DOM. No React internals,
// synthetic composer events, or client source patches are used.
export const SELECTORS = Object.freeze({
  surface: '[data-chat-surface]',
  message: '[data-slot="aui_assistant-message-root"], [data-slot="aui_user-message-root"]',
  assistantBody: '[data-slot="aui_assistant-message-content"]',
  markdown: '.aui-md',
  userBody: '[data-slot="aui_user-message-text"]',
  excluded: '[data-slot="aui_thinking-disclosure"], [data-slot="aui_reasoning-text"], [data-slot="aui_thinking-body"], [data-conversation-scaffold], button, [role="button"], input, textarea, [contenteditable], script, style, svg, [hidden]',
  editable: 'input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], [data-source-copy-dialog]',
  menu: '[data-slot="dropdown-menu-content"][role="menu"]'
})
const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'TR', 'TABLE', 'HR'])

// ac28abc96c AppContextMenu's selection-copy item: a copy codicon and a
// plain localized label. Link/image/cut/terminal menus must not be retargeted.
export function selectionCopyItem(target, menu) {
  const item = elementOf(target)?.closest('[data-slot="dropdown-menu-item"][role="menuitem"]')
  if (!item || !menu?.contains(item) || item.getAttribute('aria-disabled') === 'true') return null
  if (!item.querySelector('i.codicon-copy') || item.children.length !== 2 || item.children[1].tagName !== 'SPAN') return null
  return ['Copy', '复制', '複製', 'Kopieren', 'Copier', 'Copiar', 'Copia', 'コピー', '복사', 'نسخ'].includes(item.children[1].textContent.trim()) ? item : null
}

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

export function projectMessage(root, bodyOverride) {
  const role = root.getAttribute('data-role') || (root.matches('[data-slot="aui_user-message-root"]') ? 'user' : 'assistant')
  let bodies
  if (role === 'user') bodies = [...root.querySelectorAll(SELECTORS.userBody)]
  else {
    const content = root.querySelector(SELECTORS.assistantBody)
    bodies = content ? [...content.querySelectorAll(SELECTORS.markdown)].filter(el =>
      !el.closest(SELECTORS.excluded) && el.closest(SELECTORS.message) === root &&
      !el.parentElement.closest(SELECTORS.markdown)) : []
  }
  if (bodyOverride) bodies = bodyOverride
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
    // KaTeX's last-resort output has no annotation. Its visible text is the
    // expression, not the error title (which is diagnostics, never source).
    if (node.classList.contains('katex-error')) {
      // Upstream loses katex-display on a failed flow formula: the error
      // span becomes a direct child of the Markdown block container.
      const display = node.parentElement.tagName === 'DIV'
      if (display) separator()
      units.push({ kind: 'math', value: node.textContent.trim(), element: node })
      if (display) separator()
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

// Hermes can merge several persisted assistant rows around tool calls into one
// rendered root. Each text part still has its own Markdown body and source.
export function projectMessageParts(root, whole = projectMessage(root)) {
  return whole.role === 'user' || whole.bodies.length < 2 ? [whole] : whole.bodies.map(body => projectMessage(root, [body]))
}

// Align an entire body in source order. A formula may be a KaTeX atom or an
// exact literal delimiter/expression run after Hermes escapes CJK dollars.
// Collapse only source-proven literal runs; never search for the first match,
// skip unmatched prose, or trust an error tooltip. Members keep DOM endpoints
// so touching even one literal formula character selects its source atom.
export function alignProjection(projection, model) {
  if (!model || model.role !== projection.role) return null
  if (model.signature === projection.signature) return projection
  if (!projection.tokens) return null
  const aligned = []
  let cursor = 0
  for (const token of model.tokens) {
    if (token.key === projection.tokens[cursor]?.key) {
      aligned.push(projection.tokens[cursor++]); continue
    }
    const math = token.members.find(unit => unit.kind === 'math')
    if (!math) return null
    const raw = model.source.slice(math.start, math.end)
    const variants = [raw]
    // The client also converts bracket delimiters before its CJK guard.
    if (raw.startsWith('\\(') && raw.endsWith('\\)')) variants.push('$' + raw.slice(2, -2) + '$')
    if (raw.startsWith('\\[') && raw.endsWith('\\]')) variants.push('$$' + raw.slice(2, -2) + '$$')
    // Escaped-dollar formulas are ordinary Markdown to the renderer; escapes,
    // entities and inline emphasis can therefore affect their visible text.
    // Parse that exact alternate form, while keeping the original math atom
    // as the only source of clipboard output. Cache keys in session memory.
    if (!math.literalVariants) math.literalVariants = variants.flatMap(value => {
      const keys = [normalizeUnits(value.split('').map(value => ({ kind: 'text', value })))]
      if (value.startsWith('$') && value.endsWith('$')) {
        const count = value.startsWith('$$') ? 2 : 1
        try {
          const literal = parseSource('\\$'.repeat(count) + value.slice(count, -count) + '\\$'.repeat(count))
          if (literal.tokens.every(t => !t.key.startsWith('math:'))) keys.push(literal.tokens)
        } catch { /* An unsupported alternate representation stays unmapped. */ }
      }
      return keys
    })
    const matches = math.literalVariants
      .filter(keys => keys.every((key, index) => key.key === projection.tokens[cursor + index]?.key))
    const lengths = [...new Set(matches.map(keys => keys.length))]
    if (lengths.length !== 1) return null
    const length = lengths[0]
    aligned.push({ key: token.key, members: projection.tokens.slice(cursor, cursor + length).flatMap(t => t.members) })
    cursor += length
  }
  if (cursor !== projection.tokens.length) return null
  return { ...projection, tokens: aligned, signature: model.signature }
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
    // Renderer ids use live/earliest-part timing, which can differ from the
    // durable row's time. They cannot prove identity, even for duplicates.
    // Use exact source signatures and the complete visible display order.
    return history.flatMap((h, index) => {
      if (h.role !== p.role || !alignProjection(p, h.model)) return []
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
