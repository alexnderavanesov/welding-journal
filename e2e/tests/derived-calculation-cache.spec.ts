import { expect, test } from '@playwright/test'

import { DERIVED_CALCULATION_CACHE_VERSION, DERIVED_CALCULATION_REVISION_FLOOR } from '../../src/lib/derived-calculation-cache-version'
import { buildDerivedCalculationCacheKey } from '@/lib/derived-calculation-cache-key'
import { getOrComputeDerivedCalculation } from '@/server/derived-calculation-cache'
import { withE2eDatabase } from '../database'

test('does not reuse old rules even when the data revision exceeds the new version floor', async () => {
  const namespace = 'e2e:high-revision-policy'
  const currentKey = buildDerivedCalculationCacheKey(namespace, {})
  const keys = [`${namespace}:{}`, `rules:v${DERIVED_CALCULATION_CACHE_VERSION - 1}:${namespace}:{}`, currentKey]
  const previous = await withE2eDatabase(async (client) => {
    const state = (await client.query('select source_revision, updated_at from derived_calculation_state where id = 1')).rows[0]
    await client.query(`insert into derived_calculation_state (id, source_revision) values (1, $1)
      on conflict (id) do update set source_revision = excluded.source_revision`, [DERIVED_CALCULATION_REVISION_FLOOR + 1234])
    for (const key of keys.slice(0, 2)) await client.query(`insert into derived_calculation_cache (cache_key, source_revision, payload)
      values ($1, $2, '{"stale":true}')`, [key, DERIVED_CALCULATION_REVISION_FLOOR + 1234])
    return state
  })
  try {
    let calculations = 0
    const calculate = async () => { calculations += 1; return { stale: false } }
    expect(await getOrComputeDerivedCalculation(currentKey, calculate)).toEqual({ stale: false })
    expect(await getOrComputeDerivedCalculation(currentKey, calculate)).toEqual({ stale: false })
    expect(calculations).toBe(1)
  } finally {
    await withE2eDatabase(async (client) => {
      await client.query('delete from derived_calculation_cache where cache_key = any($1::text[])', [keys])
      if (previous) await client.query('update derived_calculation_state set source_revision = $1, updated_at = $2 where id = 1', [previous.source_revision, previous.updated_at])
      else await client.query('delete from derived_calculation_state where id = 1')
    })
  }
})

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
