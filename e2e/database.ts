import pg from 'pg'

const E2E_DATABASE_NAME = 'welding_tracker_e2e'
const E2E_DATABASE_HOST = '127.0.0.1'

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

export async function recreateE2eDatabase() {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const client = new pg.Client({ connectionString: E2E_ADMIN_DATABASE_URL })
  await client.connect()
  try {
    await client.query(`drop database if exists ${E2E_DATABASE_NAME} with (force)`)
    await client.query(`create database ${E2E_DATABASE_NAME}`)
  } finally {
    await client.end()
  }
}

export async function dropE2eDatabase() {
  assertSafeE2eDatabaseUrl(E2E_DATABASE_URL)
  const client = new pg.Client({ connectionString: E2E_ADMIN_DATABASE_URL })
  await client.connect()
  try {
    await client.query(`drop database if exists ${E2E_DATABASE_NAME} with (force)`)
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
