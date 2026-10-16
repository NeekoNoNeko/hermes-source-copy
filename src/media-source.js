// Display metadata only. Never resolve paths, fetch media or retain image bytes.
export function isImageTarget(target) {
  return /\.(?:bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(target)
}

export function imageName(target) {
  if (!/^[a-z]:[\\/]/i.test(target)) {
    try { return new URL(target).pathname.split('/').filter(Boolean).at(-1) || target } catch { /* Filesystem path. */ }
  }
  return target.split(/[\\/]/).filter(Boolean).at(-1) || target
}

// Conservative standalone directives only. Unhandled delivery syntax keeps
// the existing source-window fallback rather than guessing a rewritten path.
export function mediaDirectives(source) {
  return [...source.matchAll(/^[\t ]{0,3}(MEDIA:[\t ]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\r\n]+?)))[\t ]*\r?$/gm)]
    .flatMap(match => {
      const target = match[2] ?? match[3] ?? match[4]
      if (!target || target !== target.trim() || !(target.includes('/') || target.includes('\\') || /\.[^.]/.test(target))) return []
      // Audio/video use different controls and remain unsupported here.
      if (/\.(?:avi|flac|m4a|mkv|mov|mp3|mp4|ogg|opus|wav|webm)(?:[?#].*)?$/i.test(target)) return []
      const start = match.index + match[0].indexOf('MEDIA:')
      return [{ target, kind: isImageTarget(target) ? 'image' : 'attachment', start, end: start + match[1].length }]
    })
}
