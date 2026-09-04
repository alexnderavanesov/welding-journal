import { execFileSync } from 'node:child_process'

import {
  assertRemoteMigrationPublishedCommit,
  assertRemoteMigrationWorkspace,
} from '../src/lib/migration-branch-guard'

try {
  const branch = runGit(['branch', '--show-current'])
  const gitStatus = runGit(['status', '--porcelain', '--untracked-files=normal'])
  assertRemoteMigrationWorkspace(branch, gitStatus)

  const localHead = runGit(['rev-parse', 'HEAD'])
  const remoteMain = runGit(['ls-remote', '--exit-code', 'origin', 'refs/heads/main'])
    .trim()
    .split(/\s+/)[0]
  assertRemoteMigrationPublishedCommit(localHead, remoteMain)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
}

function runGit(args: string[]) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
