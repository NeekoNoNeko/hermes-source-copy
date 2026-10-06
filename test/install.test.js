import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('PowerShell install, verified update backup and scoped uninstall', { skip: process.platform !== 'win32' }, async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'])
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'hermes-source-copy-test-'))
  const home = path.join(temporaryRoot, 'Hermes 数据 with spaces')
  const plugin = path.join(home, 'desktop-plugins', 'hermes-source-copy')
  const sentinel = path.join(home, 'desktop-plugins', 'other-plugin')
  try {
    await mkdir(sentinel, { recursive: true })
    await writeFile(path.join(sentinel, 'plugin.js'), 'sentinel')
    const run = name => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts', name), '-HermesHome', home], { encoding: 'utf8', stdio: 'pipe' })
    assert.match(run('install.ps1'), /Installed:/)
    assert.equal(await readFile(path.join(plugin, 'plugin.js'), 'utf8'), await readFile('dist/hermes-source-copy/plugin.js', 'utf8'))
    await writeFile(path.join(plugin, 'old.txt'), 'previous version')
    assert.match(run('install.ps1'), /Previous installation backup:/)
    const backupRoot = path.join(home, 'desktop-plugin-backups')
    const backups = await readdir(backupRoot)
    assert.equal(backups.length, 1)
    assert.equal(await readFile(path.join(backupRoot, backups[0], 'old.txt'), 'utf8'), 'previous version')
    const linkedChild = path.join(plugin, 'linked-other-plugin')
    await symlink(sentinel, linkedChild, 'junction')
    for (const script of ['install.ps1', 'uninstall.ps1']) {
      assert.throws(() => run(script), /Refusing reparse point/)
      assert.equal(await readFile(path.join(sentinel, 'plugin.js'), 'utf8'), 'sentinel')
    }
    await rm(linkedChild)
    assert.match(run('uninstall.ps1'), /Uninstalled:/)
    assert.equal(await readFile(path.join(sentinel, 'plugin.js'), 'utf8'), 'sentinel')
    assert.equal((await readdir(backupRoot)).length, 1)
    assert.match(run('uninstall.ps1'), /not installed/)
  } finally {
    // mkdtemp returns this exact named temporary directory; no user workspace
    // paths are used in cleanup.
    assert.equal(path.dirname(temporaryRoot), path.resolve(tmpdir()))
    assert.ok(path.basename(temporaryRoot).startsWith('hermes-source-copy-test-'))
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
