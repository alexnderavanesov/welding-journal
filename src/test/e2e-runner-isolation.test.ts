import { afterEach, describe, expect, it, vi } from 'vitest'

const disposableUrl = 'postgresql://fixture:fixture@127.0.0.1:5432/welding_tracker_e2e'
const fixtureDirectory = '/tmp/mock-e2e-runner-owned-templates'
const mockedModules = [
  '../../e2e/database', '../../e2e/global-setup', '../../e2e/authentication',
  '../../e2e/playwright-process', 'node:fs/promises',
]

afterEach(() => {
  mockedModules.forEach(module => vi.doUnmock(module))
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('E2E runner imports only after pinning disposable storage', () => {
  it.each([undefined, 'postgresql://fixture:fixture@127.0.0.1:5432/ordinary_working_database'])(
    'pins the actual runner before setup imports when inherited DATABASE_URL=%s',
    async inheritedUrl => {
      vi.resetModules()
      vi.stubEnv('DATABASE_URL', inheritedUrl)
      vi.stubEnv('WELDING_ENV_LOADED', undefined)
      vi.stubEnv('AUDIT_SQL_COUNTS', undefined)
      vi.stubEnv('DOCUMENT_TEMPLATE_STORAGE_PATH', '/tmp/ordinary-template-storage')
      const previousExitCode = process.exitCode
      const imports: Array<{ phase: string; databaseUrl?: string; envLoaded?: string }> = []
      const steps: string[] = []
      const captureImport = (phase: string) => imports.push({
        phase, databaseUrl: process.env.DATABASE_URL, envLoaded: process.env.WELDING_ENV_LOADED,
      })
      const verify = vi.fn(async () => { steps.push('verify') })
      const setup = vi.fn(async () => { steps.push('setup'); return verify })
      const authenticate = vi.fn(async () => { steps.push('authenticate') })
      const run = vi.fn(async () => { steps.push('playwright'); return 0 })
      const drop = vi.fn(async () => { steps.push('drop') })
      const remove = vi.fn(async () => { steps.push('remove-files') })
      vi.doMock('../../e2e/database', () => ({ E2E_DATABASE_URL: disposableUrl, dropE2eDatabase: drop }))
      vi.doMock('../../e2e/global-setup', () => {
        // Setup can import fixture/application modules with module-level pools.
        // Observe the environment at import time, before its default is called.
        captureImport('setup')
        return { default: setup }
      })
      vi.doMock('../../e2e/authentication', () => {
        captureImport('authentication')
        return { prepareE2eAuthentication: authenticate }
      })
      vi.doMock('../../e2e/playwright-process', () => ({ runPlaywright: run }))
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        const methods = { mkdtemp: vi.fn(async () => fixtureDirectory), rm: remove }
        return { ...actual, ...methods, default: { ...actual, ...methods } }
      })

      try {
        // Import the actual E2E runner; no duplicate bootstrap or real
        // connection, subprocess, filesystem write or application import runs.
        await import('../../e2e/run')
        expect(imports).toEqual([
          { phase: 'setup', databaseUrl: disposableUrl, envLoaded: '1' },
          { phase: 'authentication', databaseUrl: disposableUrl, envLoaded: '1' },
        ])
        expect(steps).toEqual(['setup', 'authenticate', 'playwright', 'verify', 'drop', 'remove-files'])
        expect(authenticate).toHaveBeenCalledWith(fixtureDirectory)
        expect(remove).toHaveBeenCalledWith(fixtureDirectory, { recursive: true })
        expect(process.exitCode).toBe(0)
      } finally {
        process.exitCode = previousExitCode
      }
    },
  )
})
