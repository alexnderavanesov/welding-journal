import { expect, test } from '@playwright/test'

import { DERIVED_CALCULATION_REVISION_FLOOR } from '../../src/lib/derived-calculation-cache-version'
import { withE2eDatabase } from '../database'

test('invalidates persisted derived calculations from an older code version', async ({ page }) => {
  const staleCacheKey = 'e2e:stale-derived-calculation'

  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into derived_calculation_state (id, source_revision, updated_at)
      values (1, 42, now())
      on conflict (id) do update
      set source_revision = 42, updated_at = now()
    `)
    await client.query(`
      insert into derived_calculation_cache (cache_key, source_revision, payload, computed_at)
      values ($1, 42, '{"legacy":true}', now())
      on conflict (cache_key) do update
      set source_revision = 42, payload = '{"legacy":true}', computed_at = now()
    `, [staleCacheKey])
  })

  await page.goto('/statistics')
  await expect(page.getByRole('heading', { name: 'Статистика' })).toBeVisible()

  await expect.poll(() => withE2eDatabase(async (client) => {
    const state = await client.query<{ source_revision: number }>(
      'select source_revision from derived_calculation_state where id = 1',
    )
    const cache = await client.query<{ count: number }>(
      'select count(*)::int as count from derived_calculation_cache where cache_key = $1',
      [staleCacheKey],
    )
    return {
      sourceRevision: Number(state.rows[0]?.source_revision),
      staleCacheRows: Number(cache.rows[0]?.count),
    }
  })).toEqual({
    sourceRevision: DERIVED_CALCULATION_REVISION_FLOOR,
    staleCacheRows: 0,
  })
})
