// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { verifyPublicOutput } from './verify-public-output.mjs'

let directory
const marker = 'SYNTHETIC-LINE-913'
const options = { secrets: ['synthetic-private-credential'], fingerprints: new Set([createHash('sha256').update(marker).digest('hex')]) }
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'public-assets-')); await mkdir(path.join(directory, 'assets')) })
afterEach(async () => { await rm(directory, { recursive: true }) })
it.each([
  ['db.dump', 'example'], ['.env', 'example'], ['assets/code-12345678.js', 'PGDMP...'],
  ['assets/code-12345678.js', 'const value="synthetic-private-credential"'], ['assets/code-12345678.js', JSON.stringify({ line: marker })],
  ['assets/code-12345678.js', '-----BEGIN PRIVATE KEY-----'],
])('rejects a private artifact or its contents (%s)', async (name, contents) => {
  await writeFile(path.join(directory, name), contents)
  await expect(verifyPublicOutput(directory, options)).rejects.toThrow(/Unexpected public file|Private (?:data|fixture)/)
})
it('accepts a regular browser asset and refuses symlinks', async () => {
  const file = path.join(directory, 'assets/code-12345678.js')
  await writeFile(file, 'export const ok=true')
  expect(await verifyPublicOutput(directory, options)).toBe(1)
  await symlink(file, path.join(directory, 'linked.js'))
  await expect(verifyPublicOutput(directory, options)).rejects.toThrow('link')
})

it('keeps the public-build fingerprints current when the private seed changes', async () => {
  const { readFile } = await import('node:fs/promises')
  const records = JSON.parse(await readFile(new URL('../src/data/seed-welds.json', import.meta.url), 'utf8'))
  const expected = new Set()
  for (const row of records) {
    for (const value of [row.line, row.isometry]) {
      for (const [token] of String(value ?? '').matchAll(/[\w.-]{8,}(?:\/[\w.-]+)*/g)) {
        if (/[-/]/.test(token)) expected.add(createHash('sha256').update(token).digest('hex'))
      }
    }
  }
  const stored = JSON.parse(await readFile(new URL('./private-fixture-fingerprints.json', import.meta.url), 'utf8'))
  expect(expected.size).toBeGreaterThan(0)
  expect([...expected].every(digest => stored.includes(digest))).toBe(true)
})
