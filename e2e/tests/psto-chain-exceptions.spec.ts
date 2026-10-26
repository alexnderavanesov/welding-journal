import { filterPstoExceptions } from './psto-exception-helpers'
import { buildWeldColumnValueFilter } from '../../src/lib/weld-column-choice-filter'
import { getPstoLineIdentityKey } from '../../src/lib/psto-line-assignment'
import type { ImportPstoLinePolicy } from '../../src/lib/psto-chain-policy'
import { expect, test, type Page } from '@playwright/test'
import { withE2eDatabase } from '../database'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { deserializeRpcResponse, rpcName, serializeRpcData, siblingRpcUrl } from '../rpc'
import { auditSqlCount } from '../audit-sql'
import { revealPstoColumn } from './psto-grid-helpers'
import { drizzle } from 'drizzle-orm/node-postgres'
import { initializePstoLinePrograms } from '../../src/server/psto-program-transition'
import { attachDispatcherTaskCodesToPage } from '../../src/server/weld-read'
import type { DispatcherTaskIndexSnapshot } from '../../src/server/dispatcher-task-index'

const PROJECT = 'E2E chain PSTO exceptions'
const A = 'EXCEPTION-A', B = 'EXCEPTION-B', C = 'EXCEPTION-C'
let observed = ''
type Preview = { rowId: number; programState: string; exception: { id: number } | null; expectedVersions: { id: number; version: string }[]; rows: { rowId: number; joint: string }[] }
async function call<T>(page: Page, name: string, data: unknown, method = 'POST'): Promise<T> {
  const url = new URL(siblingRpcUrl(observed, `${name}_createServerFn_handler`)), serialized = await serializeRpcData(data)
  if (method === 'GET') url.searchParams.set('payload', serialized)
  const response = await page.request.fetch(url.href, {
    method, ...(method === 'POST' ? { data: serialized } : {}), headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
  })
  const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
  if (payload.error) throw payload.error
  return payload.result
}
async function open(page: Page) {
  page.on('request', request => { if (request.url().includes('/_serverFn/') && rpcName(request.url()).startsWith('listPstoChainExceptions_')) observed = request.url() })
  await page.goto('/psto')
  await page.locator('header').getByRole('button', { name: 'Программа ПСТО', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Требуют выравнивания', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Исключения', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Добавить исключение' })).toBeVisible()
  await expect.poll(() => observed).not.toBe('')
}
async function seed(assigned = false) {
  return withLineProgramFixture(async db => {
    const programs = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,psto_assignment)
      values ($1,'EX',$2,'II','A',100,100,$5),($1,'EX',$3,'II','A',100,100,'unassigned'),($1,'EX',$4,'II','A',100,100,'assigned') returning id,line`,
    [PROJECT, A, B, C, assigned ? 'assigned' : 'unassigned'])).rows
    const rows: { id: number; joint: string; line: string }[] = []
    for (const [line, joints] of [[A, ['S3', 'S3R1', 'S3R1W1', 'S3R1W1Y1', 'S3R1W1Y2', 'S30']], [B, ['S9']], [C, ['S8']]] as const) {
      for (const joint of joints) rows.push((await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,revision_actuality,
        category,group_name,weld_control_percent,pvk_control_percent,has_vik,connection_type,psto_required)
        values ($1,$2,'EX',$3,$4,'действующий','актуальная','II','A',100,100,'да','С17',$5) returning id,joint,line`,
      [programs.find(p => p.line === line).id, PROJECT, line, joint, line === C || (line === A && assigned) ? 'да' : null])).rows[0])
    }
    return rows
  })
}
const stored = () => withE2eDatabase(async db => (await db.query('select id,joint,line,psto_required,psto_exception_basis,psto_request,psto_result,tvmt_request,tvmt_result,tvmt_conclusion from weld_joints where project_title=$1 order by id', [PROJECT])).rows)
async function decide(page: Page, rowId: number, required: boolean | null, basis = 'Техническое решение И-12') {
  const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId, required })
  return call(page, 'savePstoChainException', { rowId, required, basis, expectedExceptionId: preview.exception?.id ?? null,
    expectedProgramState: preview.programState, expectedVersions: preview.expectedVersions })
}
test.beforeEach(() => { observed = '' })
test.afterEach(async () => { await cleanupLineProgramProjects([PROJECT]) })

test('подготовка обновления сохраняет однозначные программы, не угадывает смешанные и не меняет факты', async () => {
  await seed(true)
  await withLineProgramFixture(async db => {
    await db.query('update line_programs set psto_assignment=null where project_title=$1 and line=any($2::text[])', [PROJECT, [A, B]])
    await db.query(`insert into line_programs(project_title,subtitle_code,line) values ($1,'EX','LEGACY-MIXED'),($1,'EX','LEGACY-CANCELLED'),($1,'EX','LEGACY-EMPTY')`, [PROJECT])
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,psto_required,psto_cancellation_date,psto_control_basis)
      values ($1,'EX','LEGACY-MIXED','S100','да',null,null),($1,'EX','LEGACY-MIXED','S101',null,null,null),
      ($1,'EX','LEGACY-CANCELLED','S102','отменен','2026-10-01','Решение О-1')`, [PROJECT])
    const facts = (await db.query('select * from weld_joints where project_title=$1 order by id', [PROJECT])).rows
    // Release preparation is deliberately global. Other suite fixtures can
    // contain uninitialised programs; verify this fixture's decisions exactly,
    // count all actual transitions, and roll the probe back before committing.
    await db.query('savepoint psto_transition_probe')
    const beforeNull = Number((await db.query('select count(*) from line_programs where psto_assignment is null')).rows[0].count)
    const result = await initializePstoLinePrograms(drizzle(db))
    const afterNull = Number((await db.query('select count(*) from line_programs where psto_assignment is null')).rows[0].count)
    expect(result).toEqual({ initialized: beforeNull - afterNull, mixed: afterNull })
    expect(result.initialized).toBeGreaterThanOrEqual(4)
    const programs = (await db.query('select line,psto_assignment,psto_cancellation_date,psto_cancellation_basis from line_programs where project_title=$1 order by line', [PROJECT])).rows
    expect(programs.find(p => p.line === A).psto_assignment).toBe('assigned')
    expect(programs.find(p => p.line === B).psto_assignment).toBe('unassigned')
    expect(programs.find(p => p.line === C).psto_assignment).toBe('assigned')
    expect(programs.find(p => p.line === 'LEGACY-MIXED').psto_assignment).toBeNull()
    expect(programs.find(p => p.line === 'LEGACY-EMPTY').psto_assignment).toBe('unassigned')
    expect(programs.find(p => p.line === 'LEGACY-CANCELLED')).toMatchObject({ psto_assignment: 'cancelled', psto_cancellation_basis: 'Решение О-1' })
    expect((await db.query('select * from weld_joints where project_title=$1 order by id', [PROJECT])).rows).toEqual(facts)
    expect(await initializePstoLinePrograms(drizzle(db))).toEqual({ initialized: 0, mixed: afterNull })
    await db.query('rollback to savepoint psto_transition_probe')
  })
})

test('выбор промежуточного звена охватывает всю цепочку; снятие без документов удаляет запись исключения', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const rows = await seed()
  await open(page)
  await page.getByRole('button', { name: 'Добавить исключение' }).click()
  await filterPstoExceptions(page, 'Выбор цепочки для исключения ПСТО', 'joint', 'S3R1W1')
  const candidate = page.locator('.ag-row').filter({ has: page.locator('[col-id="joint"]', { hasText: /^S3R1W1$/ }) })
  await candidate.getByRole('button', { name: 'Выбрать цепочку' }).click()
  await expect(page.getByText('Стыков: 5', { exact: true })).toBeVisible()
  await expect(page.getByText('Исключение для всей цепочки', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Назначение исключения' })).toHaveCount(0)
  await expect(page.getByText('Без заявки ПСТО', { exact: true })).toHaveCount(0)
  await page.getByLabel('Основание исключения').fill('Техническое решение И-12')
  await page.getByRole('button', { name: 'Сохранить исключение', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Добавить исключение' })).toBeVisible()
  const after = await stored()
  expect(after.filter(r => r.joint !== 'S30' && r.line === A).every(r => r.psto_required === 'да' && r.psto_exception_basis === 'Техническое решение И-12')).toBe(true)
  expect(after.find(r => r.joint === 'S30').psto_required).toBeNull()
  const listing = await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT })
  expect(listing.totalCount).toBe(1)
  await decide(page, rows.find(r => r.joint === 'S3R1')!.id, null)
  expect((await stored()).filter(r => r.line === A).every(r => !r.psto_exception_basis)).toBe(true)
  expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT, history: true })).totalCount).toBe(0)
  expect(errors).toEqual([])
})

test('интерфейс сам предлагает снять ПСТО на назначенной линии, показывает сводку цепочки и русское меню', async ({ page }) => {
  const rows = await seed(true)
  await open(page)
  const header = page.getByRole('grid', { name: 'Исключения ПСТО', exact: true }).locator('.ag-header-cell[col-id="line"]')
  await header.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Закрепить столбец' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Сбросить столбцы' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Сбросить столбцы' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Добавить исключение' })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить исключение' }).click()
  await expect(page.getByRole('combobox', { name: 'Назначение исключения' })).toHaveCount(0)
  await filterPstoExceptions(page, 'Выбор цепочки для исключения ПСТО', 'joint', 'S3R1W1Y1')
  const candidate = page.locator('.ag-row').filter({ has: page.locator('[col-id="joint"]', { hasText: /^S3R1W1Y1$/ }) })
  await candidate.getByRole('button', { name: 'Выбрать цепочку', exact: true }).click()
  await expect(page.getByText('ПСТО нет', { exact: true })).toBeVisible()
  await expect(page.getByText('Стыков: 5', { exact: true })).toBeVisible()
  await expect(page.getByText('S3R1W1Y1', { exact: true })).toHaveCount(0)
  await expect(page.locator('summary').filter({ hasText: 'Этапы записанного НК' })).toHaveCount(0)
  await page.getByLabel('Основание исключения').fill('Исключение без выбора направления')
  await page.getByRole('button', { name: 'Сохранить исключение', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Добавить исключение' })).toBeVisible()
  expect((await stored()).filter(row => row.line === A && row.joint !== 'S30').every(row => row.psto_required === 'отменен')).toBe(true)
  expect((await stored()).find(row => row.joint === 'S30').psto_required).toBe('да')
  await page.getByRole('button', { name: 'Убрать исключение', exact: true }).click()
  await expect(page.getByText('После снятия исключения', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Убрать исключение', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Добавить исключение' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'С историей', exact: true })).toHaveCount(0)
  await expect(page.getByRole('grid', { name: 'Исключения ПСТО' })).not.toContainText('Снято')
  expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT, history: true })).totalCount).toBe(0)
  expect((await stored()).find(row => row.id === rows[0].id).psto_required).toBe('да')
})

test('устаревшее окно и неполный состав не меняют исключение; новый официальный стык наследует решение', async ({ page }) => {
  const rows = await seed(), root = rows.find(r => r.joint === 'S3')!
  await open(page)
  const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: root.id, required: true })
  const payload = { rowId: root.id, required: true, basis: 'И-1', expectedExceptionId: null, expectedProgramState: preview.programState, expectedVersions: preview.expectedVersions }
  await expect(call(page, 'savePstoChainException', { ...payload, expectedVersions: preview.expectedVersions.slice(0, 1) })).rejects.toThrow(/устарели|верси/)
  await decide(page, root.id, true)
  await expect(call(page, 'savePstoChainException', payload)).rejects.toThrow(/изменен|устарели/)
  const current = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: root.id, required: true })
  await expect(call(page, 'updateWeldJoint', { id: root.id, line: B, expectedVersion: current.expectedVersions.find(v => v.id === root.id)!.version, mutationScope: 'welding' })).rejects.toThrow(/цепочк/)
  // An official namesake is a fresh record, not a copy of stale assignment columns.
  await withLineProgramFixture(async db => { await db.query("update weld_joints set officiality='неофициальный' where id=$1", [root.id]) })
  const created = await call<{ pstoRequired: string; pstoExceptionBasis: string }>(page, 'createWeldJoint', {
    projectTitle: PROJECT, subtitleCode: 'EX', line: A, joint: 'S3', officiality: 'действующий', revisionActuality: 'актуальная',
    connectionType: 'С17', category: 'II', groupName: 'A', weldControlPercent: 100,
    pstoRequired: null, pstoExceptionBasis: 'подмена', mutationScope: 'welding',
  })
  expect(created.pstoRequired).toBe('да')
  expect(created.pstoExceptionBasis).toBe('Техническое решение И-12')
})

test('перенос всей цепочки сохраняет исключение на линии без ПСТО и закрывает на назначенной', async ({ page }) => {
  const rows = await seed(), root = rows.find(r => r.joint === 'S3')!
  await open(page)
  await decide(page, rows.find(r => r.joint === 'S3R1W1')!.id, true)
  for (const line of [B, C]) {
    const preview = await call<{ expectedRowIds: number[]; expectedVersions: { id: number; version: string }[] }>(page, 'getPstoWeldLineMovePreview', { rowId: root.id, targetIdentity: { projectTitle: PROJECT, subtitleCode: 'EX', line } })
    await call(page, 'moveWeldJointChain', { id: root.id, line, mutationScope: 'welding', expectedVersion: preview.expectedVersions.find(v => v.id === root.id)!.version,
      weldChainLineMovePlan: { ...preview, decisions: [] } })
    const chain = (await stored()).filter(r => r.joint !== 'S30' && r.joint.startsWith('S3'))
    expect(chain).toHaveLength(5)
    expect(chain.every(r => r.line === line && r.psto_required === 'да')).toBe(true)
    expect(chain.every(r => Boolean(r.psto_exception_basis) === (line === B))).toBe(true)
  }
  expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT })).totalCount).toBe(0)
})

test('снятие и повторное исключение сохраняют ПСТО, ТВМТ, номера и соседнюю позицию общего документа', async ({ page }) => {
  const rows = await seed(), root = rows.find(r => r.joint === 'S3')!, other = rows.find(r => r.joint === 'S8')!
  await withLineProgramFixture(async db => {
    await db.query(`update weld_joints set weld_date='2026-09-30',psto_request='ОБЩАЯ-ПСТО',psto_request_date='2026-10-01',psto_date='2026-10-02',psto_result='проведено',
      tvmt_request='ОБЩАЯ-ТВМТ',tvmt_request_date='2026-10-02',tvmt_result='годен',tvmt_conclusion='ОБЩЕЕ-ЗАКЛ',tvmt_conclusion_date='2026-10-03' where id=any($1::int[])`, [[root.id, other.id]])
    const [document] = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count,document_number)
      values ('pstoRequest','ОБЩАЯ-ПСТО','shared.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',2,812) returning id`)).rows
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2),($1,$3)', [document.id, root.id, other.id])
  })
  await open(page)
  await decide(page, root.id, true)
  const before = await stored()
  const documents = () => withE2eDatabase(async db => (await db.query(`select d.*, array_agg(r.weld_joint_id order by r.weld_joint_id) as positions
    from generated_documents d join generated_document_weld_joints r on r.document_id=d.id
    where d.id in (select document_id from generated_document_weld_joints where weld_joint_id=$1) group by d.id order by d.id`, [root.id])).rows)
  const originalDocuments = await documents()
  await decide(page, root.id, null)
  let after = await stored()
  expect(after.find(r => r.id === root.id)).toMatchObject({ psto_required: 'отменен', psto_request: 'ОБЩАЯ-ПСТО', tvmt_conclusion: 'ОБЩЕЕ-ЗАКЛ', tvmt_result: 'годен' })
  expect(after.find(r => r.id === other.id)).toEqual(before.find(r => r.id === other.id))
  await page.goto('/psto')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(A)
  await revealPstoColumn(page, 'pstoRequest')
  await expect(page.locator(`.ag-row[row-id="${root.id}"] [col-id="pstoRequest"]`)).toHaveText('ОБЩАЯ-ПСТО (отменен)')
  await decide(page, root.id, true)
  after = await stored()
  expect(after).toEqual(before)
  expect(await documents()).toEqual(originalDocuments)
  await page.reload()
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету' }).fill(A)
  await revealPstoColumn(page, 'pstoRequest')
  await expect(page.locator(`.ag-row[row-id="${root.id}"] [col-id="pstoRequest"]`)).toHaveText('ОБЩАЯ-ПСТО')
})

test('исключение «нет» переносится на назначенную линию и закрывается на линии без ПСТО', async ({ page }) => {
  const rows = await seed(true), root = rows.find(r => r.joint === 'S3')!
  await open(page)
  await decide(page, root.id, false)
  for (const line of [C, B]) {
    const preview = await call<{ expectedRowIds: number[]; expectedVersions: { id: number; version: string }[] }>(page, 'getPstoWeldLineMovePreview', { rowId: root.id, targetIdentity: { projectTitle: PROJECT, subtitleCode: 'EX', line } })
    await call(page, 'moveWeldJointChain', { id: root.id, line, mutationScope: 'welding', expectedVersion: preview.expectedVersions.find(v => v.id === root.id)!.version,
      weldChainLineMovePlan: { ...preview, decisions: [] } })
    const chain = (await stored()).filter(r => r.joint !== 'S30' && r.joint.startsWith('S3'))
    expect(chain.every(r => r.line === line && r.psto_required !== 'да')).toBe(true)
    expect(chain.every(r => Boolean(r.psto_exception_basis) === (line === C))).toBe(true)
  }
})

for (const required of [true, false]) test(`перенос на линию с сохранённым исключением пустой цепочки: ПСТО=${required}`, async ({ page }) => {
  const rows = await seed(!required), root = rows.find(row => row.joint === 'S3')!
  const line = required ? B : C
  // A valid active decision can outlive all its joints. A future chain with
  // that root must inherit it, including the move preview shown to the user.
  await withLineProgramFixture(async db => {
    await db.query(`insert into psto_chain_exceptions(line_program_id,root_joint,required,basis)
      select id,'s3',$3,'Сохранённое решение пустой цепочки' from line_programs where project_title=$1 and line=$2`, [PROJECT, line, required])
  })
  await open(page)
  const preview = await call<{ targetState: string; expectedRowIds: number[]; expectedVersions: { id: number; version: string }[] }>(page, 'getPstoWeldLineMovePreview', {
    rowId: root.id, targetIdentity: { projectTitle: PROJECT, subtitleCode: 'EX', line },
  })
  expect(preview.targetState).toBe(required ? 'assigned' : 'unassigned')
  await call(page, 'moveWeldJointChain', { id: root.id, line, mutationScope: 'welding', expectedVersion: preview.expectedVersions.find(item => item.id === root.id)!.version,
    weldChainLineMovePlan: { ...preview, decisions: [] } })
  const chain = (await stored()).filter(row => row.joint !== 'S30' && row.joint.startsWith('S3'))
  expect(chain).toHaveLength(5)
  expect(chain.every(row => row.line === line && (row.psto_required === 'да') === required && row.psto_exception_basis === 'Сохранённое решение пустой цепочки')).toBe(true)
})

test('предпросмотр импорта получает программы пустых линий и отдельные исключения вне отбора стыков', async ({ page }) => {
  await seed()
  await withLineProgramFixture(async db => {
    await db.query('delete from weld_joints where project_title=$1 and line=$2', [PROJECT, B])
    await db.query("update line_programs set psto_assignment='assigned' where project_title=$1 and line=$2", [PROJECT, B])
    await db.query(`insert into psto_chain_exceptions(line_program_id,root_joint,required,basis)
      select id,'s3',false,'Исключение вне отбора' from line_programs where project_title=$1 and line=$2`, [PROJECT, C])
  })
  await open(page)
  const scope = await call<{ rows: { line: string }[]; pstoLinePolicies: ImportPstoLinePolicy[] }>(page, 'listWeldingJournalImportScope', {
    columnFilters: { line: buildWeldColumnValueFilter([A]) },
  }, 'GET')
  expect(scope.rows.every(row => row.line === A)).toBe(true)
  const key = (line: string) => getPstoLineIdentityKey({ projectTitle: PROJECT, subtitleCode: 'EX', line })
  expect(scope.pstoLinePolicies.find(policy => policy.key === key(B))).toEqual({ key: key(B), state: 'assigned', exceptions: [] })
  expect(scope.pstoLinePolicies.find(policy => policy.key === key(C))).toEqual({ key: key(C), state: 'assigned', exceptions: [{ rootJoint: 's3', required: false }] })
})

test('совпавшее исключение закрывается при изменении программы и не возвращается при повторном назначении', async ({ page }) => {
  const rows = await seed(true), root = rows.find(r => r.joint === 'S3')!
  await open(page)
  await decide(page, root.id, false)
  const identity = { projectTitle: PROJECT, subtitleCode: 'EX', line: A }
  for (const action of ['remove', 'assign']) {
    const preview = await call<Preview>(page, 'getPstoLineRemovalPreview', identity)
    await call(page, 'savePstoLineAssignment', { identity, action, expectedVersions: preview.expectedVersions })
    expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT })).totalCount).toBe(0)
  }
  expect((await stored()).filter(r => r.line === A).every(r => r.psto_required === 'да' && !r.psto_exception_basis)).toBe(true)
})

test('добавление звена после просмотра останавливает сохранение всей цепочки', async ({ page }) => {
  const rows = await seed(), root = rows.find(r => r.joint === 'S3')!
  await open(page)
  const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: root.id, required: true })
  // A second operator finished creating a continuation while the first viewed the chain.
  await withLineProgramFixture(async db => { await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,officiality,has_vik)
    values ($1,'EX',$2,'S3R1W1Y1R1','действующий','да')`, [PROJECT, A]) })
  await expect(call(page, 'savePstoChainException', { rowId: root.id, required: true, basis: 'И-1', expectedExceptionId: null,
    expectedProgramState: preview.programState, expectedVersions: preview.expectedVersions })).rejects.toThrow(/устарели|верси/)
  expect((await stored()).filter(r => r.line === A).every(r => !r.psto_exception_basis)).toBe(true)
  await decide(page, root.id, true)
  expect((await stored()).filter(r => r.line === A && r.joint !== 'S30').every(r => r.psto_required === 'да')).toBe(true)
})

test('две одновременные команды сохраняют одно решение, повторный запрос не создаёт дубликат', async ({ page }) => {
  const rows = await seed(), root = rows.find(r => r.joint === 'S3')!
  await open(page)
  const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: root.id, required: true })
  const payload = { rowId: root.id, required: true, basis: 'Одновременное решение', expectedExceptionId: null,
    expectedProgramState: preview.programState, expectedVersions: preview.expectedVersions }
  const results = await Promise.allSettled([call(page, 'savePstoChainException', payload), call(page, 'savePstoChainException', payload)])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
  expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT, history: true })).totalCount).toBe(1)
})

for (const required of [true, false]) test(`диспетчер: исключение ${required} не даёт ложный СП-10, рассогласованное звено обнаруживается в индексе и журнале`, async ({ page }) => {
  const rows = await seed(!required), root = rows.find(row => row.joint === 'S3')!, child = rows.find(row => row.joint === 'S3R1W1')!
  await open(page)
  await decide(page, child.id, required)
  const check = async (inconsistent: boolean) => {
    const snapshot = await call<DispatcherTaskIndexSnapshot>(page, 'refreshDispatcherTaskSnapshot', {})
    expect(snapshot.isFresh).toBe(true)
    const tasks = snapshot.repeatedJointTasks.filter(task => task.kind === 'line-consistency' && task.fieldKey === 'pstoPresence' && task.row.projectTitle === PROJECT)
    expect(tasks).toHaveLength(inconsistent ? 1 : 0)
    const codes = await withE2eDatabase(async db => (await db.query(`select t.* from dispatcher_row_tasks t join weld_joints w on w.id=t.weld_joint_id
      where w.project_title=$1 and w.line=$2 and t.code='СП-10'`, [PROJECT, A])).rows)
    expect(codes.length > 0).toBe(inconsistent)
    expect(codes.every(code => code.code === 'СП-10')).toBe(true)
    const visible = await attachDispatcherTaskCodesToPage([{ id: child.id }]) as { id: number; dispatcherTasks: string }[]
    expect(visible[0].dispatcherTasks.split(', ').includes('СП-10')).toBe(inconsistent)
  }
  await check(false) // Scoped refresh following the exception command.
  await withLineProgramFixture(async () => {}) // Also exercise the full rebuild.
  await check(false)
  await withLineProgramFixture(db => db.query('update weld_joints set psto_required=$2 where id=$1', [child.id, required ? null : 'да']))
  await check(true)
  await decide(page, root.id, required)
  await check(false)
  await decide(page, root.id, null)
  await check(false)
})

test('после удаления последнего стыка сохранённое исключение можно снять без пустой истории', async ({ page }) => {
  const rows = await seed(), single = rows.find(r => r.joint === 'S30')!
  await open(page)
  await decide(page, single.id, true)
  const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: single.id, required: null })
  await expect(call(page, 'closeEmptyPstoChainException', preview.exception!.id)).rejects.toThrow('В цепочке появились стыки')
  await call(page, 'deleteWeldJoint', { id: single.id, version: preview.expectedVersions[0].version })
  expect(await call(page, 'getPstoExceptionRowId', preview.exception!.id)).toBeNull()
  await call(page, 'closeEmptyPstoChainException', preview.exception!.id)
  expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT })).totalCount).toBe(0)
  expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT, history: true })).totalCount).toBe(0)
})

for (const required of [true, false]) test(`будущий ремонт и его повторное создание после удаления наследуют исключение ПСТО=${required}`, async ({ page }) => {
  const rows = await seed(!required), root = rows.find(row => row.joint === 'S30')!
  await withLineProgramFixture(async db => {
    await db.query(`update weld_joints set weld_date='2026-10-01', d1=108,d2=108,t1=6,t2=6,
      vik_request='FUTURE-VIK',vik_request_date='2026-10-01',vik_result='годен',vik_conclusion='FUTURE-VIK-C',vik_conclusion_date='2026-10-02',
      has_uzk='да',uzk_request='FUTURE-UZK',uzk_request_date='2026-10-02',uzk_result='ремонт',uzk_conclusion='FUTURE-UZK-C',uzk_conclusion_date='2026-10-03',
      final_status='не годен' where id=$1`, [root.id])
  })
  await open(page)
  await decide(page, root.id, required)
  const create = async () => {
    const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: root.id, required })
    const [repair] = await call<{ id: number; joint: string; pstoRequired: string; pstoExceptionBasis: string; uzkResult: string | null }[]>(page, 'createWeldJoints', {
      source: { id: root.id, version: preview.expectedVersions.find(row => row.id === root.id)!.version }, targetJoints: ['S30R1'],
    })
    expect(repair).toMatchObject({ joint: 'S30R1', pstoRequired: required ? 'да' : 'отменен', pstoExceptionBasis: 'Техническое решение И-12' })
    expect(repair.uzkResult).not.toBe('ремонт')
    const snapshot = await call<DispatcherTaskIndexSnapshot>(page, 'refreshDispatcherTaskSnapshot', {})
    expect(snapshot.repeatedJointTasks.filter(task => task.kind === 'line-consistency' && task.fieldKey === 'pstoPresence' && task.row.projectTitle === PROJECT)).toEqual([])
    return repair
  }
  const first = await create()
  const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: root.id, required })
  await call(page, 'deleteWeldJoint', { id: first.id, version: preview.expectedVersions.find(row => row.id === first.id)!.version })
  const recreated = await create()
  expect(recreated.id).not.toBe(first.id)
  expect(await withE2eDatabase(async db => (await db.query('select uzk_result from weld_joints where id=$1', [root.id])).rows[0].uzk_result)).toBe('ремонт')
})

test('масштаб 200000: просмотр цепочки и исключений не разрастается в запросы по каждому стыку', async ({ page }) => {
  test.skip(process.env.PSTO_EXCEPTION_SCALE !== '1', 'Отдельный локальный профиль масштаба')
  test.setTimeout(180000)
  const rows = await seed(), root = rows.find(r => r.joint === 'S3')!
  await open(page)
  await decide(page, root.id, true)
  const probe = async () => {
    const before = await auditSqlCount()
    const preview = await call<Preview>(page, 'getPstoChainExceptionPreview', { rowId: root.id, required: null })
    const list = await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT })
    const candidates = await call<{ totalCount: number; rows: { linePsto: string }[] }>(page, 'searchPstoExceptionJoints', { filters: { line: buildWeldColumnValueFilter([A]) }, pageSize: 25 })
    const options = await call<{ options: { value: string }[] }>(page, 'listPstoExceptionFilterOptions', { candidates: true, field: 'joint', filters: { line: buildWeldColumnValueFilter([A]) }, match: 'S3' })
    const linePage = await call<{ totalCount: number }>(page, 'listPstoLineAssignmentPage', { filters: { line: buildWeldColumnValueFilter([A]) } })
    const lineOptions = await call<{ options: { value: string }[] }>(page, 'listPstoLineFilterOptions', { filters: { line: buildWeldColumnValueFilter([A]) }, field: 'programState', match: 'Не назначена' })
    const importScope = await call<{ pstoLinePolicies: ImportPstoLinePolicy[] }>(page, 'listWeldingJournalImportScope', { columnFilters: { line: buildWeldColumnValueFilter([A]) } }, 'GET')
    expect(importScope.pstoLinePolicies.find(policy => policy.key === getPstoLineIdentityKey({ projectTitle: PROJECT, subtitleCode: 'EX', line: A })))
      .toMatchObject({ state: 'unassigned', exceptions: [{ rootJoint: 's3', required: true }] })
    expect(linePage.totalCount).toBe(1)
    expect(lineOptions.options).toEqual([{ value: 'Не назначена', label: 'Не назначена', count: 1 }])
    const after = await auditSqlCount()
    expect(preview.rows).toHaveLength(5)
    expect(list.totalCount).toBe(1)
    expect(candidates.totalCount).toBe(6)
    expect(candidates.rows.every(row => row.linePsto === 'Не назначена')).toBe(true)
    expect(options.options).toHaveLength(6)
    return before === undefined || after === undefined ? undefined : after - before
  }
  await probe()
  const small = await probe()
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,officiality,has_vik)
      select $1,'EX','SCALE-'||(n/100),'F'||n,'действующий','да' from generate_series(1,200000) n`, [PROJECT])
    await db.query('analyze weld_joints')
  })
  const large = await probe()
  expect(small).toBeDefined()
  expect(large).toBeLessThanOrEqual(small! + 2)
  console.log(JSON.stringify({ pstoExceptions: { joints: 200008, smallSql: small, largeSql: large } }))
})

test('пагинация и фильтры охватывают все стыки; программа линии отличается от исключения', async ({ page }) => {
  const rows = await seed()
  await withLineProgramFixture(async db => {
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,officiality,has_vik)
      select p.id,$1,'EX',$2,'PAGE-'||lpad(n::text,3,'0'),'действующий','да' from line_programs p cross join generate_series(1,220) n where p.project_title=$1 and p.line=$2`, [PROJECT,A])
  })
  await open(page)
  await decide(page, rows.find(row => row.joint === 'S3')!.id, true)
  type Result = { rows: { id: number; joint: string; linePsto: string }[]; totalCount: number; page: number }
  const filters = { line: buildWeldColumnValueFilter([A]) }
  const first = await call<Result>(page, 'searchPstoExceptionJoints', { filters, pageSize: 25 })
  const last = await call<Result>(page, 'searchPstoExceptionJoints', { filters, page: 999, pageSize: 25 })
  expect(first.totalCount).toBe(226)
  expect(first.rows).toHaveLength(25)
  expect(last.page).toBe(9)
  expect(last.rows).toHaveLength(1)
  expect(first.rows.every(row => row.linePsto === 'Не назначена')).toBe(true)
  expect(first.rows.some(row => row.joint === 'PAGE-220')).toBe(false)
  const entries = await call<{ rows: { linePsto: string; required: boolean }[] }>(page, 'listPstoChainExceptions', { filters })
  expect(entries.rows[0]).toMatchObject({ linePsto: 'Не назначена', required: true })
  const facet = await call<{ options: { value: string; count: number }[]; next?: number }>(page, 'listPstoExceptionFilterOptions', { candidates: true, field: 'joint', filters })
  expect(facet.options).toHaveLength(150)
  expect(facet.next).toBe(150)

  await page.getByRole('button', { name: 'Добавить исключение' }).click()
  await expect(page.getByLabel('Поиск стыка для исключения')).toHaveCount(0)
  await filterPstoExceptions(page, 'Выбор цепочки для исключения ПСТО', 'line', A)
  await expect(page.getByText('из 226 стыков', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Следующая страница стыков' }).click()
  await expect(page.getByText('51-100', { exact: true })).toBeVisible()
  await page.getByRole('grid', { name: 'Выбор цепочки для исключения ПСТО' }).locator('[col-id="joint"] .ag-header-cell-filter-button').click()
  const panel = page.getByRole('dialog', { name: 'Фильтр: Стык' })
  await panel.getByRole('textbox', { name: 'Найти значение фильтра' }).fill('PAGE-')
  await panel.getByRole('button', { name: 'Выбрать найденные' }).click()
  await panel.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await expect(page.getByText('из 220 стыков', { exact: true })).toBeVisible()
  await filterPstoExceptions(page, 'Выбор цепочки для исключения ПСТО', 'joint', 'PAGE-220')
  await expect(page.getByText('из 1 стыков', { exact: true })).toBeVisible()
  await expect(page.getByRole('grid', { name: 'Выбор цепочки для исключения ПСТО' })).toContainText('PAGE-220')
  await page.getByRole('button', { name: 'Выбрать цепочку', exact: true }).click()
  await expect(page.getByText('Стыков: 1', { exact: true })).toBeVisible()
  // An uninitialised mixed line must not be guessed from its single displayed row.
  await withLineProgramFixture(async db => {
    await db.query('update line_programs set psto_assignment=null where project_title=$1 and line=$2', [PROJECT,B])
    await db.query("update weld_joints set psto_required='отменен' where project_title=$1 and line=$2", [PROJECT,B])
    await db.query("insert into weld_joints(project_title,subtitle_code,line,joint) values ($1,'EX',$2,'S10')", [PROJECT,B])
  })
  const mixed = await call<Result>(page, 'searchPstoExceptionJoints', { filters: { line: buildWeldColumnValueFilter([B]) } })
  expect(mixed.rows).toHaveLength(2)
  expect(mixed.rows.every(row => row.linePsto === 'Не определено')).toBe(true)
})

test('снятие исключения удаляет решение даже с документами, сохраняя документы неофициального звена', async ({ page }) => {
  const rows = await seed(), child = rows.find(row => row.joint === 'S3R1W1')!
  await withLineProgramFixture(async db => {
    await db.query("update weld_joints set officiality='неофициальный' where id=$1", [child.id])
    const [doc] = (await db.query(`insert into generated_documents(type,title,file_name,mime_type,row_count) values ('jsr','История цепочки','test.docx','application/octet-stream',1) returning id`)).rows
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values ($1,$2)', [doc.id,child.id])
  })
  await open(page)
  for (const joint of ['S3', 'S30']) {
    const root = rows.find(row => row.joint === joint)!
    await decide(page, root.id, true)
    await decide(page, root.id, null)
  }
  const history = await call<{ rows: { rootJoint: string; closedAt: string | null; linePsto: string }[]; totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT, history: true })
  expect(history.totalCount).toBe(0)
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as count from psto_chain_exceptions e join line_programs p on p.id=e.line_program_id where p.project_title=$1', [PROJECT])).rows[0].count)).toBe(0)
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int as count from generated_document_weld_joints where weld_joint_id=$1', [child.id])).rows[0].count)).toBe(1)
})

test('единая таблица линий: фильтры до пагинации, явное снятие без отмены и история неизменяемого исключения', async ({ page }) => {
  const rows = await seed(true)
  await withLineProgramFixture(async db => {
    await db.query(`insert into line_programs(project_title,subtitle_code,line,psto_assignment)
      select $1,'EX','PAGE-L'||lpad(n::text,2,'0'),'assigned' from generate_series(1,60) n`, [PROJECT])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,psto_required,psto_result)
      select id,project_title,subtitle_code,line,'F1','да','ожидает заявку' from line_programs where project_title=$1 and line like 'PAGE-L%'`, [PROJECT])
    await db.query("update weld_joints set psto_request='ИСТОРИЯ-ИСКЛЮЧЕНИЯ',psto_request_date='2026-09-01' where id=$1", [rows.find(r => r.joint === 'S3')!.id])
  })
  await open(page)
  await decide(page, rows.find(r => r.joint === 'S3')!.id, false)
  await open(page)
  await page.getByRole('button', { name: 'Линии', exact: true }).click()
  await expect(page.getByLabel('Поиск линий')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ПСТО назначена', exact: true })).toHaveCount(0)
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'projectTitle', PROJECT)
  await expect(page.getByText('из 63 линий', { exact: true })).toBeVisible()
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'programState', 'Назначена')
  await expect(page.getByText('из 62 линий', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Следующая страница линий' }).click()
  await expect(page.getByText('26-50', { exact: true })).toBeVisible()
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'line', 'PAGE-L60')
  await expect(page.getByText('из 1 линий', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Снять назначение', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Отменить ПСТО', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Снять назначение', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Снятие назначения ПСТО' })).toBeVisible()
  await expect(page.getByLabel(/Дата решения об отмене/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Снять назначение', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Программа ПСТО', exact: true })).toBeVisible()
  await expect.poll(() => withE2eDatabase(async db => (await db.query('select psto_assignment,psto_cancellation_date from line_programs where project_title=$1 and line=$2', [PROJECT,'PAGE-L60'])).rows[0])).toEqual({ psto_assignment: 'unassigned', psto_cancellation_date: null })
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click()
  await filterPstoExceptions(page, 'Линии программы ПСТО', 'line', A)
  await expect(page.getByRole('button', { name: 'Снять назначение', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Отменить ПСТО', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Снять назначение', exact: true }).click()
  await page.getByRole('button', { name: 'Снять назначение', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Программа ПСТО', exact: true })).toBeVisible()
  expect((await stored()).find(r => r.joint === 'S3').psto_request).toBe('ИСТОРИЯ-ИСКЛЮЧЕНИЯ')
  expect((await call<{ totalCount: number }>(page, 'listPstoChainExceptions', { search: PROJECT })).totalCount).toBe(0)
})

test('заголовки, фильтр без дублирования и стабильная панель; скрытие, закрепление и ширина столбца', async ({ page }) => {
  const rows = await seed()
  await open(page)
  await decide(page, rows[0].id, true)
  await open(page)
  await page.getByRole('button', { name: 'Линии', exact: true }).click()
  await page.getByRole('button', { name: 'Исключения', exact: true }).click()
  const grid = page.getByRole('grid', { name: 'Исключения ПСТО', exact: true })
  await expect(grid.locator('.ag-header-cell')).toHaveText(['Проект', 'Шифр', 'Линия', 'ПСТО линии', 'Цепочка', 'ПСТО цепочки', 'Основание', 'Действия'])
  const add = page.getByRole('button', { name: 'Добавить исключение' }), before = await add.boundingBox()
  await grid.locator('[col-id="linePsto"] .ag-header-cell-filter-button').click()
  const panel = page.getByRole('dialog', { name: 'Фильтр: ПСТО линии' })
  await expect(panel.getByText('ПСТО линии', { exact: true })).toHaveCount(1)
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  const popup = panel.locator('..')
  expect(await popup.evaluate(el => getComputedStyle(el.parentElement!, '::before').content)).not.toBe('"ПСТО линии"')
  await panel.getByRole('checkbox', { name: /Не назначена/ }).check()
  await panel.getByRole('button', { name: 'Закрыть фильтр' }).click()
  await expect(grid.getByText('S3', { exact: true })).toBeVisible()
  expect(await add.boundingBox()).toEqual(before)
  await grid.locator('[col-id="projectTitle"] .ag-header-cell-menu-button').click()
  await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
  await expect(grid.locator('.ag-header-cell[col-id="projectTitle"]')).toHaveCount(0)
  await grid.locator('[col-id="line"] .ag-header-cell-menu-button').click()
  await page.getByRole('menuitem', { name: /Закрепить столбец/ }).hover()
  await page.getByRole('menuitemcheckbox', { name: 'Слева', exact: true }).click()
  await expect(grid.locator('.ag-header .ag-grid-pinned-left-cells [col-id="line"]')).toBeVisible()
  const header = grid.locator('.ag-header-cell[col-id="line"]'), width = (await header.boundingBox())!.width
  const handle = (await header.locator('.ag-header-cell-resize').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down(); await page.mouse.move(handle.x + 45, handle.y + handle.height / 2); await page.mouse.up()
  const resized = (await header.boundingBox())!.width
  expect(resized).toBeGreaterThan(width + 20)
  await filterPstoExceptions(page, 'Исключения ПСТО', 'line', A)
  expect((await header.boundingBox())!.width).toBe(resized)
  await expect(grid.locator('.ag-header .ag-grid-pinned-left-cells [col-id="line"]')).toBeVisible()
})

test('ПСТО линии: одинаковые состояния и фильтры в исключениях и выборе цепочки', async ({ page }) => {
  const rows = await seed()
  await withLineProgramFixture(async db => {
    await db.query("update line_programs set psto_assignment=null where project_title=$1 and line=$2", [PROJECT,B])
    await db.query("update weld_joints set psto_required='отменен' where project_title=$1 and line=$2", [PROJECT,B])
  })
  await open(page)
  const legacy = await call<{ rows: { linePsto: string }[] }>(page, 'searchPstoExceptionJoints', { filters: { line: buildWeldColumnValueFilter([B]) } })
  expect(legacy.rows.map(row => row.linePsto)).toEqual(['Отменена'])
  await withLineProgramFixture(async db => {
    await db.query("update line_programs set psto_assignment='cancelled',psto_cancellation_date='2026-10-01' where project_title=$1 and line=$2", [PROJECT,B])
  })
  await decide(page, rows.find(row => row.joint === 'S3')!.id, true)
  await decide(page, rows.find(row => row.joint === 'S9')!.id, true)
  await decide(page, rows.find(row => row.joint === 'S8')!.id, false)
  const scope = { projectTitle: buildWeldColumnValueFilter([PROJECT]) }
  for (const candidates of [false, true]) {
    const facet = await call<{ options: { value: string }[] }>(page, 'listPstoExceptionFilterOptions', { candidates, field: 'linePsto', filters: scope })
    expect(facet.options.map(option => option.value).sort()).toEqual(['Назначена', 'Не назначена', 'Отменена'].sort())
    for (const [label, line] of [['Назначена', C], ['Не назначена', A], ['Отменена', B]]) {
      const result = await call<{ rows: { line: string; linePsto: string }[] }>(page, candidates ? 'searchPstoExceptionJoints' : 'listPstoChainExceptions', { filters: { ...scope, linePsto: buildWeldColumnValueFilter([label]) } })
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows.every(row => row.line === line && row.linePsto === label)).toBe(true)
    }
  }
  await open(page)
  await filterPstoExceptions(page, 'Исключения ПСТО', 'linePsto', 'Отменена')
  await expect(page.getByRole('grid', { name: 'Исключения ПСТО', exact: true }).locator('.ag-cell[col-id="linePsto"]')).toHaveText('Отменена')
  await page.getByRole('button', { name: 'Добавить исключение' }).click()
  await filterPstoExceptions(page, 'Выбор цепочки для исключения ПСТО', 'linePsto', 'Отменена')
  await expect(page.getByRole('grid', { name: 'Выбор цепочки для исключения ПСТО' }).locator('.ag-cell[col-id="linePsto"]')).toHaveText('Отменена')
})

test('Действия настраиваются во всех таблицах; сужение не разделяет общую границу столбцов', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 850 })
  const rows = await seed()
  await open(page)
  await decide(page, rows[0].id, true)
  await open(page)
  await page.getByRole('button', { name: 'Линии', exact: true }).click()
  const lines = page.getByRole('grid', { name: 'Линии программы ПСТО', exact: true })
  await expect(lines.locator('.ag-row-odd').first()).toBeVisible()
  const projectHandle = (await lines.locator('.ag-header-cell[col-id="projectTitle"] .ag-header-cell-resize').boundingBox())!
  await page.mouse.move(projectHandle.x + projectHandle.width / 2, projectHandle.y + projectHandle.height / 2)
  await page.mouse.down(); await page.mouse.move(projectHandle.x - 90, projectHandle.y + projectHandle.height / 2); await page.mouse.up()
  const checkActions = async (label: string, flexibleColumn?: string) => {
    const grid = page.getByRole('grid', { name: label, exact: true }), header = grid.locator('.ag-header-cell[col-id="actions"]')
    if (flexibleColumn) {
      const resize = (await grid.locator(`.ag-header-cell[col-id="${flexibleColumn}"] .ag-header-cell-resize`).boundingBox())!
      await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2)
      await page.mouse.down(); await page.mouse.move(resize.x - 40, resize.y + resize.height / 2); await page.mouse.up()
    }
    const expectNoGap = async () => {
      await expect.poll(() => grid.evaluate(root => {
        const central = root.querySelector('.ag-header .ag-grid-scrolling-cells')!
        const last = [...central.querySelectorAll('.ag-header-cell')].at(-1)!
        const actions = root.querySelector('.ag-header-cell[col-id="actions"]')!
        return Math.abs(actions.getBoundingClientRect().left - last.getBoundingClientRect().right)
      })).toBeLessThan(2)
      await expect.poll(() => grid.locator('.ag-row').first().evaluate(row => parseFloat(getComputedStyle(row, '::after').width))).toBeLessThan(2)
    }
    await expectNoGap()
    const fixedWidths = async () => grid.locator('.ag-header-cell').evaluateAll(headers => Object.fromEntries(
      headers.filter(cell => ['projectTitle', 'subtitleCode', 'line', 'state', 'rowCount'].includes(cell.getAttribute('col-id')!))
        .map(cell => [cell.getAttribute('col-id'), cell.getBoundingClientRect().width])))
    const before = await fixedWidths()
    const width = (await header.boundingBox())!.width, handle = (await header.locator('.ag-header-cell-resize').boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down(); await page.mouse.move(handle.x - 45, handle.y + handle.height / 2); await page.mouse.up()
    expect((await header.boundingBox())!.width).toBeGreaterThan(width + 25)
    // Shrink from the LEFT edge towards the right, including after manually
    // resizing the flexible Project column above. A painted spacer is still a gap.
    const shrinkHandle = (await header.locator('.ag-header-cell-resize').boundingBox())!
    await page.mouse.move(shrinkHandle.x + shrinkHandle.width / 2, shrinkHandle.y + shrinkHandle.height / 2)
    await page.mouse.down(); await page.mouse.move(shrinkHandle.x + 65, shrinkHandle.y + shrinkHandle.height / 2, { steps: 6 }); await page.mouse.up()
    expect((await header.boundingBox())!.width).toBeLessThan(width - 5)
    await expectNoGap()
    if (label === 'Линии программы ПСТО') expect(await fixedWidths()).toEqual(before)
    // Available space changes without resetting user widths when the dialog resizes.
    await page.setViewportSize({ width: 1650, height: 850 })
    await expectNoGap()
    await page.setViewportSize({ width: 1500, height: 850 })
    await expectNoGap()
    await page.screenshot({ path: testInfo.outputPath(`${label}-after-resize.png`) })
    await header.locator('.ag-header-cell-menu-button').click()
    await expect(page.getByRole('menuitem', { name: 'Фильтр столбца', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: /Закрепить столбец/ }).hover()
    await page.getByRole('menuitemcheckbox', { name: 'Не закреплять', exact: true }).click()
    await expect(grid.locator('.ag-header .ag-grid-pinned-right-cells [col-id="actions"]')).toHaveCount(0)
    await filterPstoExceptions(page, label, 'line', A)
    await expect(grid.locator('.ag-header .ag-grid-pinned-right-cells [col-id="actions"]')).toHaveCount(0)
    await header.locator('.ag-header-cell-menu-button').click()
    await page.getByRole('menuitem', { name: 'Скрыть столбец', exact: true }).click()
    await expect(header).toHaveCount(0)
    await grid.locator('.ag-header-cell[col-id="line"] .ag-header-cell-menu-button').click()
    await page.getByRole('menuitem', { name: 'Сбросить столбцы', exact: true }).click()
    await expect(header).toBeVisible()
  }
  await checkActions('Линии программы ПСТО')
  await page.getByRole('button', { name: 'Исключения', exact: true }).click()
  await checkActions('Исключения ПСТО', 'basis')
  await page.getByRole('button', { name: 'Добавить исключение' }).click()
  await checkActions('Выбор цепочки для исключения ПСТО', 'joint')
})
