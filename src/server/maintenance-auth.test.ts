import { describe, expect, it } from 'vitest'

import { isMaintenanceRequestAuthorized } from '@/server/maintenance-auth'

describe('maintenance request authorization', () => {
  it('accepts only the configured bearer token', () => {
    expect(isMaintenanceRequestAuthorized('Bearer secret-token', 'secret-token')).toBe(true)
    expect(isMaintenanceRequestAuthorized('Bearer wrong-token', 'secret-token')).toBe(false)
    expect(isMaintenanceRequestAuthorized('secret-token', 'secret-token')).toBe(false)
    expect(isMaintenanceRequestAuthorized(null, 'secret-token')).toBe(false)
  })
})
