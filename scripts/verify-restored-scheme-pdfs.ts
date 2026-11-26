// Operator check of a restored LOCAL database and a directory of restored PDFs.
// Does not load .env or connect to an object store.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { assertLocalMigrationDatabaseUrl } from '../src/lib/migration-branch-guard'

type Revision = { key: string; size: number; sha256: string | null }

export async function verifyRestoredPdf(directory: string, revision: Revision) {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.pdf$/i.test(revision.key)) throw new Error('Invalid PDF storage key')
  const file = await open(join(directory, revision.key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size !== revision.size) throw new Error('PDF size mismatch: ' + revision.key)
    if (revision.sha256 === null) return 'legacy' as const
    const hash = createHash('sha256')
    for await (const bytes of file.createReadStream({ autoClose: false })) hash.update(bytes)
    if (hash.digest('hex') !== revision.sha256) throw new Error('PDF checksum mismatch: ' + revision.key)
    return 'verified' as const
  } finally { await file.close() }
}

async function verifyDirectory(directory: string) {
  const url = process.env.DATABASE_URL
  assertLocalMigrationDatabaseUrl(url)
  const database = decodeURIComponent(new URL(url!).pathname.slice(1))
  if (!(await stat(directory)).isDirectory()) throw new Error('Expected a restored PDF directory')
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  const counts = { verified: 0, legacy: 0 }
  try {
    await db.query('begin isolation level repeatable read read only')
    if ((await db.query('select current_database() as name')).rows[0].name !== database) throw new Error('Unexpected database')
    // Older backups may predate the checksum column entirely.
    await db.query(`declare restored_pdfs no scroll cursor for
      select file_key as key, size, to_jsonb(r)->>'sha256' as sha256 from public.line_scheme_revisions r order by id`)
    for (;;) {
      const rows = (await db.query<Revision>('fetch forward 100 from restored_pdfs')).rows
      if (!rows.length) break
      for (const row of rows) counts[await verifyRestoredPdf(directory, row)]++
    }
    await db.query('commit')
  } finally { await db.end() }
  console.log(JSON.stringify({ database, confirmedByChecksum: counts.verified, legacySizeOnly: counts.legacy }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2]
  if (!directory) throw new Error('Укажите каталог восстановленных PDF и явный локальный DATABASE_URL.')
  verifyDirectory(resolve(directory)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
