import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const verifierPath = path.resolve('scripts/verify-server-function-manifest.mjs')
const knownHash = 'a'.repeat(64)
const missingHash = 'b'.repeat(64)

async function createFixture(rpcSource: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'server-function-manifest-'))
  const chunksDirectory = path.join(directory, '_ssr')
  await mkdir(chunksDirectory)
  await writeFile(
    path.join(directory, '__23tanstack-start-server-fn-resolver-fixture.mjs'),
    `var manifest = { "${knownHash}": { functionName: "fixture" } }`,
  )
  await writeFile(path.join(chunksDirectory, 'fixture.mjs'), rpcSource)
  return directory
}

async function runVerifier(directory: string) {
  return execFileAsync(process.execPath, [verifierPath, directory])
}

describe('server-function manifest verifier', () => {
  const fixtureDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    )
  })

  it('accepts RPC references represented in the manifest', async () => {
    const directory = await createFixture(`createSsrRpc("${knownHash}")`)
    fixtureDirectories.push(directory)

    const result = await runVerifier(directory)

    expect(result.stdout).toContain('Verified 1 server functions; 1 RPC references resolve.')
  })

  it('rejects an RPC reference missing from the manifest', async () => {
    const directory = await createFixture(`createSsrRpc("${missingHash}")`)
    fixtureDirectories.push(directory)

    await expect(runVerifier(directory)).rejects.toMatchObject({
      stderr: expect.stringContaining('1 server RPC reference(s) missing from the manifest'),
    })
  })

  it('fails closed when no recognizable RPC references exist', async () => {
    const directory = await createFixture('const rpc = "format changed"')
    fixtureDirectories.push(directory)

    await expect(runVerifier(directory)).rejects.toMatchObject({
      stderr: expect.stringContaining('No createSsrRpc references were found'),
    })
  })
})
