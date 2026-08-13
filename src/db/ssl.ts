import type { PoolConfig } from 'pg'

const CONNECTION_STRING_SSL_OPTIONS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']

export function getDatabaseConnectionConfig(
  connectionString: string,
  ca: string | undefined,
): Pick<PoolConfig, 'connectionString' | 'ssl'> {
  if (!ca) return { connectionString }

  const url = new URL(connectionString)
  for (const option of CONNECTION_STRING_SSL_OPTIONS) url.searchParams.delete(option)

  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true },
  }
}
