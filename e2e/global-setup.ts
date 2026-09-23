import { spawnSync } from 'node:child_process'

import { E2E_DATABASE_URL, recreateE2eDatabase, withE2eDatabase } from './database'

export default async function globalSetup() {
  await recreateE2eDatabase()
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
}
