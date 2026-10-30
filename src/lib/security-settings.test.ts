import { describe, expect, it } from 'vitest'
import { canManageAccount, hasPermission, normalizePermissions, type AccessIdentity } from './access-permissions'
const user: AccessIdentity = { id: 'one', name: 'Имя', email: 'one@example.test', title: 'Директор', role: 'user', permissions: ['templates.view', 'templates.edit'], revision: 1 }
describe('personal permissions replace shared passwords', () => {
  it('does not derive permissions from job title or an unrelated setting', () => {
    expect(hasPermission(user, 'templates.edit')).toBe(true)
    expect(hasPermission(user, 'dispatcher.edit')).toBe(false)
    expect(hasPermission(user, 'psto.edit')).toBe(false)
    expect(hasPermission(null, 'welding.view')).toBe(false)
  })
  it('keeps viewing separate from editing and history permissions separate', () => {
    expect(hasPermission({ ...user, permissions: ['lnk.view', 'history.joint'] }, 'lnk.edit')).toBe(false)
    expect(hasPermission({ ...user, permissions: ['history.joint'] }, 'history.view')).toBe(false)
  })
  it('only the owner manages administrators and nobody manages the protected owner or themselves', () => {
    const owner = { ...user, role: 'owner' as const }, admin = { ...user, role: 'admin' as const }
    expect(canManageAccount(owner, { id: 'two', role: 'admin' })).toBe(true)
    expect(canManageAccount(admin, { id: 'two', role: 'admin' })).toBe(false)
    expect(canManageAccount(admin, { id: 'two', role: 'user' })).toBe(true)
    expect(canManageAccount(owner, { id: 'two', role: 'owner' })).toBe(false)
    expect(canManageAccount(owner, owner)).toBe(false)
  })
  it('rejects invented permissions instead of granting a wildcard', () => {
    expect(() => normalizePermissions(['users.admin', '*'])).toThrow()
    expect(() => normalizePermissions(null)).toThrow()
    expect(normalizePermissions(['lnk.view', 'lnk.view'])).toEqual(['lnk.view'])
  })
})
