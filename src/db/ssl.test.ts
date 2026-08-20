import { describe, expect, it } from 'vitest'

import { getDatabaseConnectionConfig } from '@/db/ssl'

describe('database SSL configuration', () => {
  it('uses the configured CA and removes conflicting URL SSL options', () => {
    expect(getDatabaseConnectionConfig(
      'postgres://user:password@database.example:6432/app?sslmode=require&application_name=welding',
      'yandex-ca',
    )).toEqual({
      connectionString: 'postgres://user:password@database.example:6432/app?application_name=welding',
      ssl: {
        ca: 'yandex-ca',
        rejectUnauthorized: true,
      },
    })
  })

  it('keeps the connection-string behavior when no CA is configured', () => {
    const connectionString = 'postgres://localhost/app?sslmode=require'
    expect(getDatabaseConnectionConfig(connectionString, undefined)).toEqual({ connectionString })
  })

  it.each([
    'postgres://user:password@localhost:5432/app',
    'postgres://user:password@127.0.0.1:5432/app',
    'postgres://user:password@[::1]:5432/app',
  ])('does not apply a remote CA to a local database at %s', (connectionString) => {
    expect(getDatabaseConnectionConfig(connectionString, 'remote-ca')).toEqual({ connectionString })
  })
})
