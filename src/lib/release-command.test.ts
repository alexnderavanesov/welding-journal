import { describe, expect, it } from 'vitest'
import { parseReleaseCommand, releaseMigrationSteps } from './release-command'

const confirmations = ['--backup-confirmed', '--maintenance-window-confirmed', '--release-deployed-confirmed']
describe('explicit release command', () => {
  it('never falls back from the remote URL to the application database', () => {
    expect(() => parseReleaseCommand(['--remote', ...confirmations], { DATABASE_URL: 'postgres://local/main' })).toThrow(/DATABASE_URL_REMOTE_FOR_MIGRATIONS/)
    const result = parseReleaseCommand(['--remote', ...confirmations], {
      DATABASE_URL: 'postgres://local/main', DATABASE_URL_REMOTE_FOR_MIGRATIONS: 'postgres://user:secret@remote/production',
    })
    expect(result.database).toBe('production')
    expect(result.host).toBe('remote')
  })
  it.each(confirmations)('rejects missing %s before connecting', missing => {
    expect(() => parseReleaseCommand(['--remote', ...confirmations.filter(flag => flag !== missing)], {})).toThrow(/До подключения/)
  })
  it('rejects typos, remote shortcuts, wrong local hosts and ambiguous targets', () => {
    for (const args of [[], ['--local', '--remote'], ['--remote', ...confirmations, '--data-only'], ['--remote', ...confirmations, '--apply-local'], ['--remote', ...confirmations, '--force']]) {
      expect(() => parseReleaseCommand(args, {})).toThrow()
    }
    expect(() => parseReleaseCommand(['--local', '--apply-local'], { DATABASE_URL: 'postgres://remote/welding_tracker' })).toThrow(/localhost/)
    expect(() => parseReleaseCommand(['--local', '--apply-local'], { DATABASE_URL: 'postgres://localhost/other' })).toThrow(/явно выбранной/)
    expect(parseReleaseCommand(['--local', '--apply-local', '--data-only'], { DATABASE_URL: 'postgres://127.0.0.1/welding_tracker_test_release' }).dataOnly).toBe(true)
  })
  it('retains the old safeguards and backfill in the proper order', () => {
    expect(releaseMigrationSteps(true)).toEqual([
      ['tsx', 'scripts/prepare-legacy-weld-column-cleanup.ts', '--remote'],
      ['drizzle-kit', 'migrate', '--config=drizzle.remote.config.ts'],
      ['tsx', 'scripts/backfill-lnk-defect-descriptions.ts', '--remote'],
    ])
    expect(releaseMigrationSteps(false).flat().join(' ')).not.toContain('--remote')
  })

  it('rejects a remote host override or an implicit environment-selected host before connecting', () => {
    for (const url of ['postgres://user:pass@expected/db?host=elsewhere', 'postgres:///db']) {
      expect(() => parseReleaseCommand(['--remote', ...confirmations], { DATABASE_URL_REMOTE_FOR_MIGRATIONS: url })).toThrow()
    }
  })
})
