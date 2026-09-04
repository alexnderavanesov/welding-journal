export const MIGRATION_BRANCH = 'main'

export function assertMigrationBranch(branch: unknown) {
  const currentBranch = String(branch ?? '').trim()
  if (currentBranch === MIGRATION_BRANCH) return

  const branchLabel = currentBranch || 'не определена (detached HEAD)'
  throw new Error(
    `Миграции разрешено запускать только из ветки ${MIGRATION_BRANCH}. Текущая ветка: ${branchLabel}.`,
  )
}
