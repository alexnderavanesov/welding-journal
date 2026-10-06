import { beforeEach, expect, it, vi } from 'vitest'

const { query, connect, end } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn() }))
vi.mock('pg', () => ({ default: { Client: class { query = query; connect = connect; end = end } } }))

beforeEach(() => {
  vi.resetModules()
  query.mockReset()
  connect.mockReset().mockResolvedValue(undefined)
  end.mockReset().mockResolvedValue(undefined)
})

it('preserves a pre-existing test database even when runner cleanup follows setup refusal', async () => {
  query.mockResolvedValue({ rows: [{ oid: 42 }] })
  const database = await import('../../e2e/database')
  await expect(database.createE2eDatabase()).rejects.toThrow(/already exists/)
  await database.dropE2eDatabase()
  expect(query).toHaveBeenCalledTimes(1)
  expect(query.mock.calls[0][0]).toMatch(/^select/)
})

it('verifies an empty exact target and only drops the database this run created', async () => {
  query.mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ oid: 43 }] })
    .mockResolvedValueOnce({ rows: [{ name: 'welding_tracker_e2e', tables: 0 }] })
    .mockResolvedValueOnce({ rows: [{ oid: 43 }] })
    .mockResolvedValueOnce({ rows: [] })
  const database = await import('../../e2e/database')
  await database.createE2eDatabase()
  await expect(database.createE2eDatabase()).rejects.toThrow(/already owns/)
  await database.dropE2eDatabase()
  await database.dropE2eDatabase()
  expect(query).toHaveBeenCalledTimes(6)
  expect(query.mock.calls[3][0]).toContain('current_database()')
  expect(query.mock.calls[5][0]).toBe('drop database welding_tracker_e2e with (force)')
})

it('does not drop a different database that replaced the owned target', async () => {
  query.mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ oid: 43 }] })
    .mockResolvedValueOnce({ rows: [{ name: 'welding_tracker_e2e', tables: 0 }] })
    .mockResolvedValueOnce({ rows: [{ oid: 44 }] })
  const database = await import('../../e2e/database')
  await database.createE2eDatabase()
  await expect(database.dropE2eDatabase()).rejects.toThrow(/replaced externally/)
  expect(query.mock.calls.some(([sql]) => /^drop /i.test(sql))).toBe(false)
})

it('does not acquire cleanup ownership if a concurrent create wins', async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('already exists'))
  const database = await import('../../e2e/database')
  await expect(database.createE2eDatabase()).rejects.toThrow(/already exists/)
  await database.dropE2eDatabase()
  expect(query).toHaveBeenCalledTimes(2)
})

it.each([
  { name: 'welding_tracker', tables: 0 },
  { name: 'welding_tracker_e2e', tables: 1 },
])('refuses setup without the exact empty initial state: %j', async identity => {
  query.mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ oid: 43 }] })
    .mockResolvedValueOnce({ rows: [identity] })
  const database = await import('../../e2e/database')
  await expect(database.createE2eDatabase()).rejects.toThrow(/exact empty/)
})
