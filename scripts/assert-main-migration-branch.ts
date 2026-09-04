import { execFileSync } from 'node:child_process'

import { assertMigrationBranch } from '../src/lib/migration-branch-guard'

try {
  const branch = execFileSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assertMigrationBranch(branch)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}
