// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type pg from 'pg'
import { assertInventory, sourceName, targetName, type BackupManifest } from '../e2e/s3-backup-archive'
import { verifyRestoredPdf } from './verify-restored-scheme-pdfs'

it('compares restored bytes with the database, including same-size corruption and legacy revisions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restored-pdf-'))
  try {
    const bytes = Buffer.from('%PDF-test')
    const row = { key: '00000000-0000-4000-8000-000000000001.pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    await writeFile(join(dir, row.key), bytes)
    expect(await verifyRestoredPdf(dir, row)).toBe('verified')
    await writeFile(join(dir, row.key), Buffer.from('%PDF-lost'))
    await expect(verifyRestoredPdf(dir, row)).rejects.toThrow('checksum mismatch')
    expect(await verifyRestoredPdf(dir, { ...row, sha256: null })).toBe('legacy')
    await expect(verifyRestoredPdf(dir, { ...row, size: 10 })).rejects.toThrow('size mismatch')
    await expect(verifyRestoredPdf(dir, { ...row, key: '../outside' })).rejects.toThrow('storage key')
  } finally { await rm(dir, { recursive: true }) }
})

it('compares archived PDF checksums with the restored database even when the manifest is internally consistent', async () => {
  const digest = createHash('sha256').update('archived PDF').digest('hex')
  const entry = { key: '00000000-0000-4000-8000-000000000001.pdf', size: 12, pageCount: 1,
    revisionId: '00000000-0000-4000-8000-000000000002', bundleId: 1, active: false }
  let dbDigest: string | null = digest
  const db = { query: async (sql: string) => ({ rows: sql.includes('current_database()')
    ? [{ name: targetName }] : [{ ...entry, dbDigest }] }) } as unknown as pg.Client
  const manifest: BackupManifest = { kind: 'synthetic-s3-backup-v1', createdAt: new Date().toISOString(),
    sourceDatabase: sourceName, bucket: 'welding-journal-schemes-test', database: { file: 'database.dump', size: 0, sha256: '' },
    objects: [{ ...entry, sha256: digest }] }
  await assertInventory(db, manifest)
  await expect(assertInventory(db, { ...manifest, objects: [] })).rejects.toThrow('every restored revision')
  manifest.objects[0]!.sha256 = createHash('sha256').update('modified PDF').digest('hex')
  await expect(assertInventory(db, manifest)).rejects.toThrow('database revision checksum')
  dbDigest = null
  await assertInventory(db, manifest)
})
