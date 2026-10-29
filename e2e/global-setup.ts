import { spawnSync } from 'node:child_process'

import { E2E_DATABASE_URL, createE2eDatabase, withE2eDatabase } from './database'

export default async function globalSetup() {
  await createE2eDatabase()
  const migration = spawnSync('pnpm', ['db:migrate'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      WELDING_ENV_LOADED: '1',
    },
    encoding: 'utf8',
  })
  if (migration.status !== 0) {
    throw new Error(`E2E migration failed:\n${migration.stdout}\n${migration.stderr}`)
  }

  const preparation = spawnSync('pnpm', ['db:prepare-release-local'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
    encoding: 'utf8',
  })
  if (preparation.status !== 0) throw new Error(`E2E release preparation failed:\n${preparation.stdout}\n${preparation.stderr}`)

  // Explicit comparison with a saved bundle after an index-only migration.
  // Only this runner's newly created disposable DB can receive the old marker.
  if (process.env.E2E_BASELINE_SCHEMA_TIME) await withE2eDatabase(async client => {
    const time = Number(process.env.E2E_BASELINE_SCHEMA_TIME)
    if (!Number.isSafeInteger(time) || time <= 0) throw new Error('Invalid baseline schema time')
    const applied = await client.query('select 1 from drizzle.__drizzle_migrations where created_at=$1', [time])
    if (applied.rowCount !== 1) throw new Error('Baseline migration must already be applied')
    await client.query("update app_settings set value=$1 where key='maintenance:release:line-program:v1'",
      [JSON.stringify({ status: 'complete', schemaTime: time })])
  })

  await withE2eDatabase(async (client) => {
    await client.query(`
      insert into weld_joints (
        weld_date,
        project_title,
        subtitle_code,
        line,
        isometry,
        joint,
        spool,
        officiality,
        revision_actuality,
        welding_method,
        connection_type,
        material_group,
        d1,
        d2,
        t1,
        t2,
        wdi,
        stamp_1_k,
        stamp_1_k_fact,
        has_vik,
        vik_control_basis,
        psto_required,
        final_status,
        welding_updated_at,
        psto_created_at,
        psto_updated_at,
        lnk_created_at,
        lnk_updated_at
      ) values (
        '2026-08-01',
        'E2E проект',
        'E2E-001',
        'E2E-L1',
        'ISO-E2E',
        'F1',
        'E2E-S1',
        'действующий',
        'актуальная',
        'РД',
        'СШ',
        'M01',
        108,
        108,
        4,
        4,
        0.42,
        'E2E-K1',
        'E2E-K1',
        'да',
        'проект',
        'да',
        'ожидает НК',
        now(),
        now(),
        now(),
        now(),
        now()
      )
    `)

  })

  if (process.env.AUDIT_CHAIN_SCALE === '1') {
    const { seedChainScaleBackground } = await import('./chain-scale-fixture')
    return seedChainScaleBackground()
  }
}
