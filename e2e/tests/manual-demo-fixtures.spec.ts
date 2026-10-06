import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'

test('демонстрационные примеры соответствуют новым правилам, проверка полностью откатывается', async () => {
  const before = await counts()
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed-local-manual-demo.ts', '--check'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' },
    timeout: 30_000,
  })
  const result = JSON.parse(stdout)
  expect(result.applied).toBe(false)
  expect(result.summary.created).toBe(50)
  expect(result.summary.tasks['ДЗ-05']).toBeGreaterThan(0)
  expect(result.summary.tasks['ДЗ-06']).toBeGreaterThan(0)
  expect(await counts()).toEqual(before)
})

function counts() {
  return withE2eDatabase(async client => (await client.query(`select
    (select count(*)::int from weld_joints) as welds,
    (select count(*)::int from line_programs) as lines,
    (select count(*)::int from welder_stamps) as stamps,
    (select count(*)::int from generated_documents) as documents,
    (select count(*)::int from pre_heat_treatment_controls) as pre,
    (select count(*)::int from duplicate_controls) as duplicates,
    (select count(*)::int from psto_repeat_cycles) as cycles,
    (select jsonb_agg(to_jsonb(s) order by key) from app_settings s) as settings
  `)).rows[0])
}

test('пример сохранённой истории до ТО создаётся отдельно и при проверке полностью откатывается', async () => {
  const before = await counts()
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed-local-retained-history-demo.ts', '--check'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 30_000,
  })
  const result = JSON.parse(stdout)
  expect(result.applied).toBe(false)
  expect(result.summary).toMatchObject({ created: 1, joint: 'F901', line: 'Л2', preResult: 'годен' })
  expect(result.summary.primaryResult).not.toBe('годен')
  expect(await counts()).toEqual(before)
})

test('пример помощника катушки проверяется изолированно с полным откатом', async () => {
  const before = await counts()
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed-local-coil-correction-demo.ts', '--check'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1' }, timeout: 30_000,
  })
  expect(JSON.parse(stdout)).toMatchObject({ applied: false, summary: { created: 6, physicalJoints: 2, line: 'Л-КАТ' } })
  expect(await counts()).toEqual(before)
})
