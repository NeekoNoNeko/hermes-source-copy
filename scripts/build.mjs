import { build } from 'esbuild'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist', 'hermes-source-copy')
await mkdir(out, { recursive: true })
const result = await build({
  absWorkingDir: root, entryPoints: ['src/plugin.js'], outfile: path.join(out, 'plugin.js'),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: false,
  external: ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'], metafile: true,
  legalComments: 'eof', banner: { js: '// Hermes Source Copy 1.0.0 — MIT — built for Hermes Desktop ac28abc96c' }
})
const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports)
if (imports.some(item => !['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'].includes(item.path))) throw new Error('Unsupported runtime import in plugin')
const bytes = await readFile(path.join(out, 'plugin.js'))
// Hermes Install from Git detects this prebuilt root entry; it runs no npm build.
await writeFile(path.join(root, 'plugin.js'), bytes)
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const notices = ['Third-party dependencies bundled in Hermes Source Copy\n']
for (const [packagePath, item] of Object.entries(lock.packages)) {
  if (!packagePath || item.dev) continue
  const name = item.name || packagePath.split('node_modules/').at(-1)
  notices.push(`\n===== ${name} ${item.version} (${item.license || 'see package license'}) =====\n`)
  for (const candidate of ['license', 'LICENSE', 'LICENSE.md', 'LICENSE-MIT', 'license.md', 'LICENSE.txt']) {
    try { notices.push(await readFile(path.join(root, packagePath, candidate), 'utf8')); break } catch { /* Try conventional next filename. */ }
  }
}
await writeFile(path.join(out, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))
await writeFile(path.join(out, 'SHA256.txt'), `${createHash('sha256').update(bytes).digest('hex')}  plugin.js\n`)
await writeFile(path.join(out, 'build-info.json'), JSON.stringify({
  id: 'hermes-source-copy', version: '1.0.0', hermesBaseline: 'ac28abc96c',
  sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length
}, null, 2) + '\n')
console.log(`Built dist/hermes-source-copy/plugin.js (${bytes.length} bytes); runtime imports verified.`)
