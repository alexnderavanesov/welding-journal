import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const mode = process.argv[2]
if (!['pre-commit', 'pre-push'].includes(mode)) throw new Error('Expected pre-commit or pre-push')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const code = path => !path.startsWith('docs/') && path !== 'AGENTS.md' && path !== 'README.md'
const paths = (...args) => git(...args, '-z').split('\0').filter(Boolean)
let verifiedHead

if (mode === 'pre-push') {
  const updates = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => line.split(/\s+/)).filter(parts => !/^0+$/.test(parts[1] ?? ''))
  if (!updates.length) process.exit(0) // Deleting a remote ref sends no code.
  const head = git('rev-parse', 'HEAD').trim()
  verifiedHead = head
  if (updates.some(parts => parts[1] !== head)) {
    console.error('Проверка остановлена: отправляется коммит, отличный от HEAD. Выполните проверку из рабочей копии отправляемого коммита.')
    process.exit(1)
  }
}
// Tests read the checkout. Refuse to certify a different staged/committed tree;
// never hide edits with an automatic stash, reset, checkout or git add.
const unstaged = paths('diff', '--name-only').filter(code)
const untracked = paths('ls-files', '--others', '--exclude-standard').filter(code)
const staged = paths('diff', '--cached', '--name-only').filter(code)
if (mode === 'pre-commit' && !staged.length) process.exit(0)
if (unstaged.length || untracked.length || mode === 'pre-push' && staged.length) {
  console.error('Проверка остановлена: проверяемая рабочая копия отличается от подготовленного к коммиту/отправке кода. Сначала согласуйте состав изменений; автоматическое сохранение или откат не выполняются.')
  process.exit(1)
}
const command = mode === 'pre-commit' ? 'test:workflow-contracts' : 'verify'
const checkedIndex = git('ls-files', '--stage', '-z')
console.log(`Проверка ${mode}: pnpm ${command}`)
const result = spawnSync('pnpm', [command], { stdio: 'inherit', env: { ...process.env,
  // Validation/build must never inherit a production connection from .env.
  DATABASE_URL: 'postgresql://verification:verification@127.0.0.1:1/welding_verification_no_database', WELDING_ENV_LOADED: '1',
} })
if (result.error) console.error(result.error.message)
if (result.status !== 0) process.exit(result.status ?? 1)
if (git('ls-files', '--stage', '-z') !== checkedIndex || verifiedHead && git('rev-parse', 'HEAD').trim() !== verifiedHead) {
  console.error('Состав коммита или HEAD изменился во время проверки. Повторите проверку подготовленного кода.')
  process.exit(1)
}
if (paths('diff', '--name-only').filter(code).length || paths('ls-files', '--others', '--exclude-standard').filter(code).length) {
  console.error('Проверка изменила исходные файлы. Просмотрите изменения и повторите подготовку коммита.')
  process.exit(1)
}
