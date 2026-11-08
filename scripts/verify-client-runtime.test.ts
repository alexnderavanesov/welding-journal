import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile), directories: string[] = []
const verifier = path.resolve('scripts/verify-client-runtime.mjs')
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true }) })
async function fixture(source: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'client-runtime-'))
  directories.push(directory)
  await mkdir(path.join(directory, 'assets'))
  await writeFile(path.join(directory, 'assets', 'app.js'), source)
  return directory
}
it('accepts browser assets without request-local Node state', async () => {
  const { stdout } = await run(process.execPath, [verifier, await fixture('const app = {}; export { app };')])
  expect(stdout).toContain('Verified 1 client assets')
})
it.each([
  'new (shim()).AsyncLocalStorage;',
  'import {AsyncLocalStorage as Store} from "node:async_hooks";new Store();',
])('rejects Node request-local runtime even after Vite externalizes it: %s', async source => {
  await expect(run(process.execPath, [verifier, await fixture(source)])).rejects.toMatchObject({
    stderr: expect.stringContaining('Node request-local runtime leaked into client assets: assets/app.js'),
  })
})
