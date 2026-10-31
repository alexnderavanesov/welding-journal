import { execFileSync } from 'node:child_process'
import { accessSync, chmodSync, constants } from 'node:fs'
import { resolve } from 'node:path'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
let previous = ''
try { previous = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim() } catch (error) {
  if (error.status !== 1) throw error
}
if (previous && previous !== '.githooks' && resolve(root, previous) !== resolve(root, '.githooks')) {
  throw new Error('Уже настроен другой core.hooksPath. Сначала объедините существующие проверки; настройка не изменена.')
}
for (const name of ['pre-commit', 'pre-push']) {
  const old = execFileSync('git', ['rev-parse', '--git-path', `hooks/${name}`], { encoding: 'utf8' }).trim()
  try {
    accessSync(old, constants.F_OK)
    if (!previous) throw new Error(`Уже существует ${name}. Сначала объедините проверки; файл не изменён.`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  chmodSync(resolve(root, '.githooks', name), 0o755)
}
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'])
console.log('Локальные проверки включены: быстрые контракты перед коммитом, verify перед push. Коммит и push не выполнялись.')
