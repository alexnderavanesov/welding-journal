export const MIGRATION_BRANCH = 'main'

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function assertMigrationBranch(branch: unknown) {
  const currentBranch = String(branch ?? '').trim()
  if (currentBranch === MIGRATION_BRANCH) return

  const branchLabel = currentBranch || 'не определена (detached HEAD)'
  throw new Error(
    `Миграции разрешено запускать только из ветки ${MIGRATION_BRANCH}. Текущая ветка: ${branchLabel}.`,
  )
}

export function assertLocalMigrationDatabaseUrl(databaseUrl: unknown) {
  const rawUrl = String(databaseUrl ?? '').trim()
  if (!rawUrl) {
    throw new Error('DATABASE_URL is not configured')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new Error('DATABASE_URL должна быть корректным PostgreSQL URL локальной базы.')
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('DATABASE_URL должна использовать протокол postgres или postgresql.')
  }
  if (!LOCAL_DATABASE_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error(
      'Локальная миграция остановлена: DATABASE_URL указывает не на localhost. '
      + 'Для удаленной базы разрешена только команда pnpm db:remote-migration.',
    )
  }
}

export function assertRemoteMigrationWorkspace(branch: unknown, gitStatus: unknown) {
  assertMigrationBranch(branch)
  if (!String(gitStatus ?? '').trim()) return

  throw new Error(
    'Удаленная миграция остановлена: рабочая копия содержит незакоммиченные изменения. '
    + 'Сначала требуется завершить проверку и опубликовать чистый релизный main.',
  )
}

export function assertRemoteMigrationPublishedCommit(localHead: unknown, remoteMainHead: unknown) {
  const localCommit = String(localHead ?? '').trim().toLowerCase()
  const remoteCommit = String(remoteMainHead ?? '').trim().toLowerCase()
  if (localCommit && localCommit === remoteCommit) return

  throw new Error(
    'Удаленная миграция остановлена: локальный HEAD не совпадает с опубликованным origin/main. '
    + 'База не подключалась. Сначала требуется опубликовать и проверить релизный коммит.',
  )
}
