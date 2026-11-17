import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBusinessDateIso } from '../../src/lib/business-date'
import { DATA_RELEASE_KEY } from '../../src/lib/release-contract'
import { E2E_DATABASE_URL, withE2eDatabase } from '../database'

test.skip(process.env.E2E_USE_PRODUCTION_BUILD !== '1', 'Requires the built Nitro server')
const state = () => withE2eDatabase(async db => (await db.query(
  'select source_revision,computed_revision,computed_at from dispatcher_task_index_state where id=1',
)).rows[0])
const facts = () => withE2eDatabase(async db => (await db.query(
  'select row_to_json(w)::text as value from weld_joints w order by id',
)).rows)

async function launch(enabled: boolean, directory: string, port: number) {
  const preload = join(directory, `clock-${port}.mjs`)
  // Test-process clock only: production has no configurable accelerated clock.
  // The server crosses 06:30 five real seconds after loading this preload.
  await writeFile(preload, `
    const OriginalDate = Date;
    const started = performance.now();
    const epoch = Date.parse(${JSON.stringify(`${getBusinessDateIso()}T03:29:55.000Z`)});
    const now = () => epoch + performance.now() - started;
    globalThis.Date = new Proxy(OriginalDate, {
      construct(target, args) { return Reflect.construct(target, args.length ? args : [now()]); },
      get(target, key) { return key === 'now' ? now : Reflect.get(target, key); }
    });
  `)
  const child = spawn(process.execPath, ['--import', preload, '.output/server/index.mjs'], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, WELDING_ENV_LOADED: '1',
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      DISPATCHER_PREWARM_ENABLED: enabled ? '1' : '0', MAINTENANCE_TOKEN: '',
      TZ: 'America/Los_Angeles', FORCE_COLOR: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout!.on('data', data => { output += data.toString() })
  child.stderr!.on('data', data => { output += data.toString() })
  const live = async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(1000) })).status }
    catch { return 0 }
  }
  return { child, output: () => output, live }
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await exited } finally { clearTimeout(timeout) }
}

test('built scheduler prepares a new day, shares fresh results across instances and preserves facts', async () => {
  const { prepareDispatcherCalculation } = await import('../../src/server/dispatcher-prewarm')
  await prepareDispatcherCalculation()
  const originalFacts = await facts()
  await withE2eDatabase(db => db.query("update dispatcher_task_index_state set computed_at=computed_at-interval '1 day' where id=1"))
  const before = await state()
  const directory = await mkdtemp(join(tmpdir(), 'welding-prewarm-clock-'))
  const servers: Awaited<ReturnType<typeof launch>>[] = []
  try {
    servers.push(await launch(true, directory, 3128), await launch(true, directory, 3129))
    for (const server of servers) {
      await expect.poll(server.live).toBe(200)
      expect(server.output()).toContain('06:30 Europe/Moscow')
    }
    for (const server of servers) await expect.poll(server.output, { timeout: 25000 }).toContain('Актуальный расчёт готов:')
    const after = await state()
    expect(after.source_revision).toBe(before.source_revision + 1)
    expect(after.computed_revision).toBe(after.source_revision)
    expect(getBusinessDateIso(after.computed_at)).toBe(getBusinessDateIso())
    expect(await facts()).toEqual(originalFacts)
    for (const server of servers) expect(server.output()).not.toContain('Утренняя подготовка не завершена')
  } finally {
    for (const server of servers) await stop(server.child)
    await rm(directory, { recursive: true, force: true })
  }
})

test('built scheduler respects explicit disable and refuses an unprepared release without stopping the server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'welding-prewarm-clock-'))
  const before = await state()
  const [release] = await withE2eDatabase(async db => (await db.query('select value from app_settings where key=$1', [DATA_RELEASE_KEY])).rows)
  const servers: Awaited<ReturnType<typeof launch>>[] = []
  try {
    await withE2eDatabase(db => db.query('update app_settings set value=$1 where key=$2', ['not prepared', DATA_RELEASE_KEY]))
    servers.push(await launch(false, directory, 3128), await launch(true, directory, 3129))
    for (const server of servers) await expect.poll(server.live).toBe(200)
    await expect.poll(servers[1].output, { timeout: 25000 }).toContain('Утренняя подготовка не завершена')
    expect(servers[0].output()).not.toContain('[dispatcher-prewarm]')
    expect(servers[1].output()).not.toContain('Актуальный расчёт готов:')
    expect(await state()).toEqual(before)
    for (const server of servers) expect(await server.live()).toBe(200)
  } finally {
    for (const server of servers) await stop(server.child)
    await withE2eDatabase(db => db.query('update app_settings set value=$1 where key=$2', [release.value, DATA_RELEASE_KEY]))
    await rm(directory, { recursive: true, force: true })
  }
})
