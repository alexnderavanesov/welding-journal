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
})
