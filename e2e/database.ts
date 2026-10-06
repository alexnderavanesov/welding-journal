import pg from 'pg'

const E2E_DATABASE_NAME = 'welding_tracker_e2e'
const E2E_DATABASE_HOST = '127.0.0.1'
let ownedDatabaseOid: number | undefined

export const E2E_ADMIN_DATABASE_URL =
  `postgresql://welding:welding@${E2E_DATABASE_HOST}:5432/postgres`
export const E2E_DATABASE_URL =
  `postgresql://welding:welding@${E2E_DATABASE_HOST}:5432/${E2E_DATABASE_NAME}`

export function assertSafeE2eDatabaseUrl(url: string) {
  const parsed = new URL(url)
  if (parsed.hostname !== E2E_DATABASE_HOST || parsed.pathname !== `/${E2E_DATABASE_NAME}`) {
    throw new Error(`E2E refused unsafe database URL: ${parsed.hostname}${parsed.pathname}`)
  }
}

export async function createE2eDatabase() {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  if (ownedDatabaseOid !== undefined) throw new Error('This process already owns an E2E database.')
  const client = new pg.Client({ connectionString: E2E_ADMIN_DATABASE_URL })
  await client.connect()
  try {
    const existing = await client.query('select oid from pg_database where datname=$1', [E2E_DATABASE_NAME])
    if (existing.rows.length) throw new Error('E2E database already exists. Refusing to replace another run or its diagnostic data.')
    await client.query(`create database ${E2E_DATABASE_NAME}`)
    const created = await client.query('select oid from pg_database where datname=$1', [E2E_DATABASE_NAME])
    if (!created.rows[0]?.oid) throw new Error('Cannot verify ownership of the new E2E database; preserving it.')
    ownedDatabaseOid = created.rows[0].oid
    await withE2eDatabase(async database => {
      const identity = await database.query("select current_database() as name, (select count(*)::int from information_schema.tables where table_schema='public') as tables")
      if (identity.rows[0]?.name !== E2E_DATABASE_NAME || identity.rows[0]?.tables !== 0) {
        throw new Error('E2E setup requires the exact empty disposable database.')
      }
    })
  } finally {
    await client.end()
  }
}

export async function dropE2eDatabase() {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  // The runner calls this even if setup failed. Never remove a pre-existing DB.
  if (ownedDatabaseOid === undefined) return
  const client = new pg.Client({ connectionString: E2E_ADMIN_DATABASE_URL })
  await client.connect()
  try {
    const current = await client.query('select oid from pg_database where datname=$1', [E2E_DATABASE_NAME])
    if (current.rows.length && current.rows[0].oid !== ownedDatabaseOid) {
      throw new Error('E2E database was replaced externally. Refusing to delete it.')
    }
    if (current.rows.length) await client.query(`drop database ${E2E_DATABASE_NAME} with (force)`)
    ownedDatabaseOid = undefined
  } finally {
    await client.end()
  }
}

export async function withE2eDatabase<T>(run: (client: pg.Client) => Promise<T>) {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}
