import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const runner = resolve('scripts/run-git-verification.mjs')
const installer = resolve('scripts/install-verification-hooks.mjs')
const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture(exit = 0, mutate = false) {
  const dir = mkdtempSync(join(tmpdir(), 'welding-hook-test-')); directories.push(dir)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '--quiet')
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'bin'))
  writeFileSync(join(dir, '.gitignore'), 'bin/\ncalled\n')
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1\n')
  git('add', '.gitignore', 'src/a.ts')
  writeFileSync(join(dir, 'bin/pnpm'), `#!/bin/sh\nprintf '%s\\n' "$1" "$DATABASE_URL" "$WELDING_ENV_LOADED" > called\n${mutate ? 'echo changed >> src/a.ts\n' : ''}exit ${exit}\n`, { mode: 0o755 })
  const run = (mode = 'pre-commit', input = '') => spawnSync(process.execPath, [runner, mode], { cwd: dir, encoding: 'utf8', input,
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, DATABASE_URL: 'postgresql://must-not-use.invalid/production' } })
  return { dir, git, run }
}
it('runs the quick checks against the exact staged code and prevents remote DB inheritance', () => {
  const { dir, git, run } = fixture()
  const before = git('diff', '--cached')
  expect(run().status).toBe(0)
  expect(readFileSync(join(dir, 'called'), 'utf8')).toBe('test:workflow-contracts\npostgresql://verification:verification@127.0.0.1:1/welding_verification_no_database\n1\n')
  expect(git('diff', '--cached')).toBe(before)
})
it.each(['unstaged', 'untracked'])('refuses %s source changes without editing or hiding them', kind => {
  const { dir, git, run } = fixture()
  const before = git('diff', '--cached')
  const path = join(dir, kind === 'unstaged' ? 'src/a.ts' : 'src/new.ts')
  writeFileSync(path, 'keep this work\n')
  expect(run().status).toBe(1)
  expect(readFileSync(path, 'utf8')).toBe('keep this work\n')
  expect(git('diff', '--cached')).toBe(before)
  expect(() => readFileSync(join(dir, 'called'))).toThrow()
})
it('allows unrelated draft documentation while checking staged source', () => {
  const { dir, run } = fixture()
  mkdirSync(join(dir, 'docs')); writeFileSync(join(dir, 'docs/draft.md'), 'draft')
  expect(run().status).toBe(0)
})
it('blocks on a failed check and on source changes produced by a successful check', () => {
  expect(fixture(7).run().status).toBe(7)
  expect(fixture(0, true).run().status).toBe(1)
})
it('does not overwrite existing hook configuration', () => {
  const { dir, git } = fixture()
  git('config', '--local', 'core.hooksPath', 'custom-hooks')
  const result = spawnSync(process.execPath, [installer], { cwd: dir, encoding: 'utf8' })
  expect(result.status).toBe(1)
  expect(git('config', '--get', 'core.hooksPath').trim()).toBe('custom-hooks')
})
it('runs full verify only for the checked HEAD and skips a deletion-only push', () => {
  const { dir, run } = fixture()
  const head = 'a'.repeat(40), zero = '0'.repeat(40)
  // Simulate Git's ref input and a clean checkout without creating any commits
  // or contacting a remote repository.
  writeFileSync(join(dir, 'bin/git'), `#!/bin/sh\nif [ "$1" = rev-parse ]; then echo ${head}; fi\nexit 0\n`, { mode: 0o755 })
  expect(run('pre-push', `refs/heads/main ${head} refs/heads/main ${zero}\n`).status).toBe(0)
  expect(readFileSync(join(dir, 'called'), 'utf8')).toMatch(/^verify\n/)
  rmSync(join(dir, 'called'))
  expect(run('pre-push', `refs/heads/main ${'b'.repeat(40)} refs/heads/main ${zero}\n`).status).toBe(1)
  expect(run('pre-push', `(delete) ${zero} refs/heads/old ${head}\n`).status).toBe(0)
  expect(() => readFileSync(join(dir, 'called'))).toThrow()
})
