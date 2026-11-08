import { expect, test, type Page } from '@playwright/test'
import { asE2eOwner } from '../with-owner-access'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { withE2eDatabase } from '../database'
import { editJournalJoint } from '../journal-grid'
import { createWeldJoint as rawCreate, createWeldJoints as rawContinue, updateWeldJoint as rawUpdate, updateWeldJoints as rawBatch } from '@/server/weld-mutations'
import { importWeldJoints as rawImport, massFillWeldJoints as rawMass, replaceWeldJoints as rawReplace } from '@/server/weld-import'
import { createEarlyCoilDecision as rawCoil } from '@/server/early-coil-workflow'
import { changeCard as rawCard } from '@/server/technology-cards'
import { loadRemoteGeneratedDocumentRows as rawDocumentRows } from '@/server/generated-documents'
import { previewLnkOfficialityChange as rawOfficialityPreview, applyLnkOfficialityChange as rawOfficialityApply } from '@/server/lnk-officiality-workflow'
import { ensureDispatcherTaskIndexFresh } from '@/server/dispatcher-task-index'
import { DEFAULT_DATA_LIST_SETTINGS } from '@/lib/data-list-settings'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from '@/lib/control-process-settings'
import type { WeldPayload } from '@/server/weld-contracts'
import type { PstoWeldLineMovePreview } from '@/lib/psto-line-assignment'
import { deserializeRpcResponse, serializeRpcData, siblingRpcUrl } from '../rpc'

const project = 'E2E T OP weld core', stamp = 'TOP1', cardName = 'E2E T OP TK'
const scope = { projectTitle: project, subtitleCode: 'TOP', line: 'TOP-CORE' }
const base: WeldPayload = { ...scope, connectionType: 'Т1', weldingMethod: 'РД', materialGroup: 'М05',
  d1: 57, t1: 6, weldLength: '600.123456789123456789', weldDate: '2026-07-01', stamp1K: stamp }
const create = asE2eOwner(rawCreate, 'welding.edit'), update = asE2eOwner(rawUpdate, 'welding.edit')
const batch = asE2eOwner(rawBatch, 'welding.edit'), continuation = asE2eOwner(rawContinue, 'welding.edit')
const importRows = asE2eOwner(rawImport, 'welding.import'), mass = asE2eOwner(rawMass, 'welding.import'), replace = asE2eOwner(rawReplace, 'welding.import')
const coil = asE2eOwner(rawCoil, 'welding.edit'), card = asE2eOwner(rawCard, 'references.edit')
const documentRows = asE2eOwner(rawDocumentRows, 'documents.view')
const officialityPreview = asE2eOwner(rawOfficialityPreview, 'lnk.edit'), officialityApply = asE2eOwner(rawOfficialityApply, 'lnk.edit')
const snapshots = new Map<string, { value: string; updated_at: Date } | undefined>()
const stored = (id: number) => withE2eDatabase(async db => (await db.query("select to_jsonb(w)||jsonb_build_object('weld_length',w.weld_length::text) record,xmin::text version from weld_joints w where id=$1", [id])).rows[0])
const versions = async (ids: number[]) => Promise.all(ids.map(async id => ({ id, version: (await stored(id)).version as string })))
const permits = () => ['М01', 'М05'].flatMap(materialGroups => ['РАД', 'РД'].map(weldType => ({
  id: `${materialGroups}:${weldType}`, weldType, materialGroups, diameterFrom: '57', diameterTo: '57', thicknessFrom: '6', thicknessTo: '6',
  validFrom: '2026-01-01', validTo: '2026-12-31', note: '', archived: false,
})))

test.beforeEach(async () => {
  snapshots.clear()
  await withLineProgramFixture(async db => {
    for (const key of ['save-check', 'data-list', 'control-processes']) snapshots.set(key, (await db.query('select value,updated_at from app_settings where key=$1', [key])).rows[0])
    const settings = { ...DEFAULT_SAVE_CHECK_SETTINGS, ...JSON.parse(snapshots.get('save-check')?.value ?? '{}'), officialDls: true }
    const dataList = { ...DEFAULT_DATA_LIST_SETTINGS, connectionTypes: ['С17', 'У19', 'Т1'] }
    for (const [key, value] of [['save-check', settings], ['data-list', dataList]] as const) {
      await db.query('insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()', [key, JSON.stringify(value)])
    }
    await db.query('insert into welder_stamps(naks_stamp,welder_name,naks_permits,dls_permits) values($1,$2,$3,$4)',
      [stamp, 'Т/ОП обе группы и все способы', JSON.stringify(permits()), JSON.stringify(permits().map(value => ({ ...value, number: 'TOP-DLS' })))])
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,$2,$3,'II','Б(а)',0,0)`, [scope.projectTitle, scope.subtitleCode, scope.line])
  })
})

test.afterEach(async ({ context }) => {
  await Promise.all(context.pages().map(page => page.close()))
  await cleanupLineProgramProjects([project])
  await withLineProgramFixture(async db => {
    await db.query('delete from welder_stamps where naks_stamp=$1', [stamp])
    await db.query('delete from technology_cards where name=$1', [cardName])
    for (const [key, snapshot] of snapshots) {
      if (snapshot) await db.query('update app_settings set value=$1,updated_at=$2 where key=$3', [snapshot.value, snapshot.updated_at, key])
      else await db.query('delete from app_settings where key=$1', [key])
    }
  })
})

test('UI: создание Т/ОП, одна геометрия и дробная L без округления', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  const editor = page.getByRole('dialog')
  const line = editor.getByRole('textbox', { name: 'Линия', exact: true })
  await line.fill(scope.line)
  await editor.getByRole('button', { name: `${scope.line} Проект: ${project} · Шифр: ${scope.subtitleCode}`, exact: true }).click()
  await editor.getByRole('textbox', { name: 'Стык', exact: true }).fill('ОП-UI')
  await editor.getByRole('combobox', { name: 'Тип соединения', exact: true }).selectOption('Т1')
  for (const [label, value] of [['D1', '57'], ['T1', '6'], ['Длина шва, мм', '600.123456789123456789']]) await editor.getByLabel(label, { exact: true }).fill(value)
  for (const label of ['D2', 'T2', 'WDI', 'Клеймо_2', 'Клеймо_2 - факт']) await expect(editor.getByLabel(label, { exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  const record = await withE2eDatabase(async db => (await db.query('select id,weld_length::text,d2,t2,wdi from weld_joints where project_title=$1 and joint=$2', [project, 'ОП-UI'])).rows[0])
  expect(record).toMatchObject({ weld_length: '600.123456789123456789', d2: null, t2: null, wdi: null })
  await editJournalJoint(page, record.id)
  await editor.getByLabel('Длина шва, мм', { exact: true }).fill('700.987654321')
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toBeHidden()
  expect((await stored(record.id)).record.weld_length).toBe('700.987654321')
})

test('сервер: семейство, один сварщик и все одновременно обнаружимые ошибки импорта', async () => {
  const original = await create({ data: { ...base, joint: 'ОП-1' } })
  const peer = await create({ data: { ...base, joint: 'ОП-2' } })
  const before = await stored(original.id), peerBefore = await stored(peer.id)
  await expect(update({ data: { id: original.id, expectedVersion: before.version, joint: 'S1', connectionType: 'С17' } })).rejects.toThrow('Сохранённое соединение нельзя переводить')
  const invalid = { id: original.id, weldLength: -10, stamp1ZFact: stamp }
  for (const write of [
    () => batch({ data: { records: [{ id: peer.id, isometry: 'ROLLBACK' }, invalid], expectedVersions: [{ id: original.id, version: before.version }, { id: peer.id, version: peerBefore.version }] } }),
    () => replace({ data: { records: [invalid], deleteIds: [peer.id], expectedVersions: [{ id: original.id, version: before.version }, { id: peer.id, version: peerBefore.version }] } }),
    () => importRows({ data: { records: [{ ...base, joint: 'ОП-3' }, { ...base, joint: 'ОП-4', weldLength: -10, stamp1ZFact: stamp }] } }),
  ]) await expect(write()).rejects.toThrow(/Длина шва должна.*Клеймо_2/s)
  expect(await stored(original.id)).toEqual(before)
  expect(await stored(peer.id)).toEqual(peerBefore)
  expect(await withE2eDatabase(async db => (await db.query('select count(*)::int n from weld_joints where project_title=$1', [project])).rows[0].n)).toBe(2)
  await expect(mass({ data: { records: [{ id: original.id, stamp1ZFact: stamp }], expectedVersions: [{ id: original.id, version: before.version }] } })).rejects.toThrow('Клеймо_2')
})

test('ТК и допуск: одна группа и один способ по D1/T1, первый ввод даты', async () => {
  const savedCard = await card({ action: 'create', card: { name: cardName, connectionType: 'Т1', weldingMethods: ['РД'],
    materialGroups: ['М05'], diameterFrom: 57, diameterTo: 57, thicknessFrom: 6, thicknessTo: 6, psto: 'any' } })
  const row = await create({ data: { ...base, joint: 'ОП-TK', weldDate: null } })
  expect((await stored(row.id)).record.technology_card_number).toBeNull()
  await update({ data: { id: row.id, expectedVersion: (await stored(row.id)).version, weldDate: base.weldDate } })
  expect((await stored(row.id)).record.technology_card_number).toBe(cardName)
  const revision = await withE2eDatabase(async db => (await db.query('select revision from technology_cards where id=$1', [savedCard.id])).rows[0].revision)
  await card({ action: 'archive', id: savedCard.id, expectedRevision: revision, archived: true })
  await update({ data: { id: row.id, expectedVersion: (await stored(row.id)).version, isometry: 'ARCHIVED-TK-KEPT' } })
  expect((await stored(row.id)).record.technology_card_number).toBe(cardName)
  await withLineProgramFixture(db => db.query('update welder_stamps set naks_permits=$1,dls_permits=$2 where naks_stamp=$3',
    [JSON.stringify(permits().filter(value => value.weldType !== 'РД')), JSON.stringify(permits().filter(value => value.weldType !== 'РД').map(value => ({ ...value, number: 'TOP-DLS' }))), stamp]))
  await update({ data: { id: row.id, expectedVersion: (await stored(row.id)).version, weldingJournalNote: 'Unrelated correction remains available' } })
  await expect(update({ data: { id: row.id, expectedVersion: (await stored(row.id)).version, weldDate: '2026-07-02' } })).rejects.toThrow(/СП-02.*РД/s)
  await expect(create({ data: { ...base, joint: 'ОП-METHOD' } })).rejects.toThrow(/СП-02.*РД/s)
  await withLineProgramFixture(db => db.query('update welder_stamps set naks_permits=$1,dls_permits=$2 where naks_stamp=$3',
    [JSON.stringify(permits().filter(value => value.materialGroups === 'М01')), JSON.stringify(permits().filter(value => value.materialGroups === 'М01').map(value => ({ ...value, number: 'TOP-DLS' }))), stamp]))
  await expect(create({ data: { ...base, joint: 'ОП-MAT' } })).rejects.toThrow(/СП-02.*М05/s)
})

for (const stage of ['primary', 'beforeHeatTreatment'] as const) test(`Т НК ${stage}: ВИК→ПВК→УЗК, ПВК только годен, D57 ремонт и атомарный отказ дубля РК`, async ({ page }) => {
  const pre = stage === 'beforeHeatTreatment'
  const process = (pvkGoodOnly: boolean) => withLineProgramFixture(db => db.query(`insert into app_settings(key,value) values('control-processes',$1)
    on conflict(key) do update set value=excluded.value,updated_at=now()`, [JSON.stringify({ ...DEFAULT_CONTROL_PROCESS_SETTINGS,
      // This matrix exercises method/result rules on an assigned preliminary
      // stage; the selective default deliberately starts a new chain without it.
      preHeatTreatmentMode: pre ? 'allPsto' : DEFAULT_CONTROL_PROCESS_SETTINGS.preHeatTreatmentMode, pvkGoodOnly })]))
  await process(false)
  if (pre) await withLineProgramFixture(db => db.query("update line_programs set psto_assignment='assigned' where project_title=$1 and line=$2", [project, scope.line]))
  const row = await create({ data: { ...base, joint: 'ОП-NK', hasPvk: 'да', hasUzk: 'да' } })
  if (pre) expect((await stored(row.id)).record.psto_required).toBe('да')
  const rpc = await supportRaceRpc(page)
  const keys = { 'ВИК': 'vik', 'ПВК': 'pvk', 'УЗК': 'uzk', 'РК': 'rk' } as const
  type Method = keyof typeof keys
  const request = async (id: number, methods: Method[]) => pre
    ? rpc('savePreHeatTreatmentLnkWorkflow', { action: 'request', date: '2026-07-02', expectedVersions: await versions([id]),
      groups: [{ name: `TOP-${stage}-REQ-${id}`, useSystemName: false, positions: methods.map(methodCode => ({ rowId: id, methodCode })) }] })
    : rpc('updateWeldJoint', { id, mutationScope: 'lnk', expectedVersion: (await stored(id)).version,
      ...Object.fromEntries(methods.flatMap(method => [[`${keys[method]}Request`, `TOP-${stage}-REQ-${id}`], [`${keys[method]}RequestDate`, '2026-07-02']])) })
  const result = async (id: number, method: Method, value: string) => pre
    ? rpc('savePreHeatTreatmentLnkWorkflow', { action: 'result', date: '2026-07-03', expectedVersions: await versions([id]),
      groups: [{ name: `TOP-${stage}-${method}-${id}`, useSystemName: false, positions: [{ rowId: id, methodCode: method }] }],
      results: [{ rowId: id, methodCode: method, result: value }] })
    : rpc('updateWeldJoint', { id, mutationScope: 'lnk', expectedVersion: (await stored(id)).version,
      [`${keys[method]}Result`]: value, [`${keys[method]}Conclusion`]: `TOP-${stage}-${method}-${id}`, [`${keys[method]}ConclusionDate`]: '2026-07-03' })
  const state = async () => ({ weld: await stored(row.id), ...await withE2eDatabase(async db => ({
    pre: (await db.query('select to_jsonb(c) record from pre_heat_treatment_controls c where weld_joint_id=$1 order by id', [row.id])).rows,
    duplicates: (await db.query('select to_jsonb(c) record from duplicate_controls c where weld_joint_id=$1 order by id', [row.id])).rows,
    documents: (await db.query(`select d.id,d.type,d.title,d.row_count,array_agg(a.weld_joint_id order by a.weld_joint_id) members
      from generated_documents d join generated_document_weld_joints a on a.document_id=d.id
      where d.id in (select document_id from generated_document_weld_joints where weld_joint_id=$1) group by d.id order by d.id`, [row.id])).rows,
  })) })
  const refused = async (run: () => Promise<unknown>, reason: RegExp) => {
    const before = await state()
    await expect(run()).rejects.toThrow(reason)
    expect(await state()).toEqual(before)
  }
  await refused(() => request(row.id, ['ВИК', 'РК']), /РК/)
  await request(row.id, ['ВИК', 'ПВК', 'УЗК'])
  await refused(() => result(row.id, 'ПВК', 'годен'), /ВИК/)
  await refused(() => result(row.id, 'УЗК', 'ремонт'), /ВИК/)
  await result(row.id, 'ВИК', 'годен')
  await refused(() => result(row.id, 'УЗК', 'ремонт'), /ПВК/)
  await process(true)
  await refused(() => result(row.id, 'ПВК', 'ремонт'), /ПВК — только годен/)
  await result(row.id, 'ПВК', 'годен')
  await refused(() => result(row.id, 'УЗК', 'вырез'), /Т.*вырез|вырез.*Т/s)
  await result(row.id, 'УЗК', 'ремонт')
  if (pre) expect(await withE2eDatabase(async db => (await db.query('select method,result from pre_heat_treatment_controls where weld_joint_id=$1 order by method', [row.id])).rows))
    .toEqual([{ method: 'ВИК', result: 'годен' }, { method: 'ПВК', result: 'годен' }, { method: 'УЗК', result: 'ремонт' }])
  else expect((await stored(row.id)).record).toMatchObject({ d1: 57, vik_result: 'годен', pvk_result: 'годен', uzk_result: 'ремонт' })
  // Off must actually permit a new own rejected PVK, not merely leave a rejected
  // historical value untouched after a settings change.
  await process(false)
  const pvk = await create({ data: { ...base, joint: 'ОП-PVK', hasPvk: 'да', hasUzk: 'да' } })
  await request(pvk.id, ['ВИК', 'ПВК'])
  await result(pvk.id, 'ВИК', 'годен')
  await result(pvk.id, 'ПВК', 'ремонт')
  if (pre) expect(await withE2eDatabase(async db => (await db.query("select result from pre_heat_treatment_controls where weld_joint_id=$1 and method='ПВК'", [pvk.id])).rows[0].result)).toBe('ремонт')
  else expect((await stored(pvk.id)).record.pvk_result).toBe('ремонт')
  await process(true)
  const duplicate = { weldJointId: row.id, method: 'ПВК', result: 'ремонт', controlDate: '2026-07-04', conclusion: `TOP-${stage}-DUP`, conclusionDate: '2026-07-04' }
  await refused(() => rpc('saveDuplicateControl', { ...duplicate, method: 'РК', result: 'годен' }), /Для Т РК запрещён/)
  await refused(() => rpc('saveDuplicateControls', { records: [duplicate, { ...duplicate, method: 'РК', result: 'годен' }] }), /Для Т РК запрещён/)
  const saved = await rpc<{ method: string; result: string }>('saveDuplicateControl', duplicate)
  expect(saved).toMatchObject({ method: 'ПВК', result: 'ремонт' })
  expect(await withE2eDatabase(async db => (await db.query("select count(*)::int n from duplicate_controls where weld_joint_id=$1 and method='РК'", [row.id])).rows[0].n)).toBe(0)
})

test('L: весь R1…R12, документы и факты сохраняются; устаревшие одиночные и пакетные правки откатываются', async ({ page }) => {
  const rows = await seedChain(12), original = rows[0], last = rows.at(-1)!
  const documentId = await withLineProgramFixture(async db => {
    const id = (await db.query("insert into generated_documents(type,title,file_name,mime_type,row_count) values('weldingJournal','TOP document','top.html','text/html',2) returning id")).rows[0].id
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) values($1,$2),($1,$3)', [id, original.id, last.id])
    return id as number
  })
  await ensureDispatcherTaskIndexFresh()
  const before = await stored(original.id), staleRepair = await stored(last.id)
  const factsBefore = await chainFacts()
  await update({ data: { id: original.id, expectedVersion: before.version, weldLength: '800.987654321987654321' } })
  expect(await lengths()).toEqual(Array(13).fill('800.987654321987654321'))
  expect(await chainFacts()).toEqual(factsBefore)
  const docRows = await documentRows(documentId)
  expect(docRows.map(row => row.weldLength)).toEqual(['800.987654321987654321', '800.987654321987654321'])
  const document = await withE2eDatabase(async db => (await db.query('select title,file_name,row_count from generated_documents where id=$1', [documentId])).rows[0])
  expect(document).toEqual({ title: 'TOP document', file_name: 'top.html', row_count: 2 })
  await expect(update({ data: { id: last.id, expectedVersion: staleRepair.version, weldingJournalNote: 'STALE' } })).rejects.toThrow(/измен|Обновите/i)
  await expect(batch({ data: { records: [{ id: original.id, weldLength: 900 }, { id: last.id, weldingJournalNote: 'STALE' }],
    expectedVersions: [{ id: original.id, version: (await stored(original.id)).version }, { id: last.id, version: staleRepair.version }] } })).rejects.toThrow(/измен|Обновите/i)
  expect(await lengths()).toEqual(Array(13).fill('800.987654321987654321'))
  await replace({ data: { records: [{ id: original.id, weldLength: null }], deleteIds: [], expectedVersions: await versions([original.id]) } })
  expect(await lengths()).toEqual(Array(13).fill(null))
  await mass({ data: { records: [{ id: original.id, weldLength: 901.111222333 }], expectedVersions: await versions([original.id]) } })
  expect(await lengths()).toEqual(Array(13).fill('901.111222333'))
  await page.goto('/journal')
  await page.getByRole('searchbox', { name: 'Быстрый поиск по отчету', exact: true }).fill(project)
  await editJournalJoint(page, last.id)
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Редактирование стыка', exact: true }) })
  await expect(editor.getByLabel('Длина шва, мм', { exact: true })).toHaveAttribute('readonly')
  await expect(editor.getByLabel('Длина шва, мм', { exact: true })).toHaveValue('901.111222333')
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
})

test('конкурирующие исправления L дают одну целую цепочку и один конфликт версий', async () => {
  const rows = await seedChain(2), original = rows[0]
  const version = (await stored(original.id)).version
  const outcomes = await Promise.allSettled([1000.12345, 2000.98765].map(weldLength => update({ data: { id: original.id, expectedVersion: version, weldLength } })))
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter(value => value.status === 'rejected')).toHaveLength(1)
  const current = String((await stored(original.id)).record.weld_length)
  expect(await lengths()).toEqual(Array(3).fill(current))
})

test('L: сохранённая физическая связь охватывает перенесённый ремонт, его версии и диспетчер другой линии', async () => {
  const rows = await seedChain(2), original = rows[0], last = rows.at(-1)!
  const movedScope = { ...scope, line: 'TOP-MOVED' }
  // Legacy split history is an input fixture; normal operators still use the
  // dedicated complete-chain move and retain its safety guards.
  await withLineProgramFixture(async db => {
    for (let index = 1; index < rows.length; index++) await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      values($1,'repair',$2,$3) on conflict(weld_joint_id) do update set physical_root_id=excluded.physical_root_id,source_row_id=excluded.source_row_id`,
    [rows[index].id, original.id, rows[index - 1].id])
    const lineId = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,$2,$3,'II','Б(а)',0,0) returning id`, [project, scope.subtitleCode, movedScope.line])).rows[0].id
    await db.query('update weld_joints set line=$1,line_program_id=$2 where id=$3', [movedScope.line, lineId, last.id])
  })
  const namesake = await create({ data: { ...base, ...movedScope, joint: 'ОП-CHAIN', weldLength: '321' } })
  // СП-03 also covers incomplete stamp groups. Complete this independent part
  // of the fixture so the task's appearance/removal isolates the missing L.
  await withLineProgramFixture(db => db.query(`update weld_joints set stamp_1_k_fact=stamp_1_k where id=any($1::int[])`, [[...rows.map(row => row.id), namesake.id]]))
  await ensureDispatcherTaskIndexFresh()
  const stale = await stored(last.id), facts = await chainFacts()
  const chainLengths = () => withE2eDatabase(async db => (await db.query('select weld_length::text from weld_joints where id=any($1::int[]) order by id', [rows.map(row => row.id)])).rows.map(row => row.weld_length))
  const missingLengthTask = () => withE2eDatabase(async db => (await db.query("select count(*)::int n from dispatcher_row_tasks where weld_joint_id=$1 and code='СП-03'", [last.id])).rows[0].n)
  expect(await missingLengthTask()).toBe(0)
  await update({ data: { id: original.id, expectedVersion: (await stored(original.id)).version, weldLength: null } })
  expect(await chainLengths()).toEqual([null, null, null])
  expect((await stored(namesake.id)).record.weld_length).toBe('321')
  expect(await chainFacts()).toEqual(facts)
  const dirty = await withE2eDatabase(async db => JSON.parse((await db.query('select dirty_scopes from dispatcher_task_index_state where id=1')).rows[0].dirty_scopes))
  expect(dirty).toEqual(expect.arrayContaining([scope, movedScope]))
  await ensureDispatcherTaskIndexFresh()
  expect(await missingLengthTask()).toBeGreaterThan(0)
  await expect(update({ data: { id: last.id, expectedVersion: stale.version, weldingJournalNote: 'STALE' } })).rejects.toThrow(/измен|Обновите/i)
  await batch({ data: { records: [{ id: original.id, weldLength: '800.123456789123456789' }], expectedVersions: await versions([original.id]) } })
  expect(await chainLengths()).toEqual(Array(3).fill('800.123456789123456789'))
  await ensureDispatcherTaskIndexFresh()
  expect(await missingLengthTask()).toBe(0)
  await replace({ data: { records: [{ id: original.id, weldLength: null }], deleteIds: [], expectedVersions: await versions([original.id]) } })
  expect(await chainLengths()).toEqual([null, null, null])
  await mass({ data: { records: [{ id: original.id, weldLength: '900.987654321987654321' }], expectedVersions: await versions([original.id]) } })
  expect(await chainLengths()).toEqual(Array(3).fill('900.987654321987654321'))
  expect((await stored(namesake.id)).record.weld_length).toBe('321')
  const rootVersion = (await stored(original.id)).version, repairVersion = (await stored(last.id)).version
  const concurrent = await Promise.allSettled([
    update({ data: { id: original.id, expectedVersion: rootVersion, weldLength: '1000.111222333444555666' } }),
    update({ data: { id: last.id, expectedVersion: repairVersion, weldingJournalNote: 'Concurrent factual correction' } }),
  ])
  expect(concurrent[0].status).toBe('fulfilled')
  if (concurrent[1].status === 'rejected') expect(String(concurrent[1].reason)).toMatch(/измен|Обновите/i)
  expect(await chainLengths()).toEqual(Array(3).fill('1000.111222333444555666'))
  expect((await stored(namesake.id)).record.weld_length).toBe('321')
})

for (const moveFirst of [true, false]) test(`L и перенос B→C: ${moveFirst ? 'перенос' : 'длина'} первым получает блокировку; устаревшая операция отклоняется и безопасно повторяется`, async ({ page }) => {
  const rows = await seedChain(2), original = rows[0], repair = rows.at(-1)!
  const b = { ...scope, line: 'TOP-MOVE-B' }, c = { ...scope, line: 'TOP-MOVE-C' }
  await withLineProgramFixture(async db => {
    for (let index = 1; index < rows.length; index++) await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
      values($1,'repair',$2,$3) on conflict(weld_joint_id) do update set physical_root_id=excluded.physical_root_id,source_row_id=excluded.source_row_id`,
    [rows[index].id, original.id, rows[index - 1].id])
    for (const identity of [b, c]) await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
      values($1,$2,$3,'II','Б(а)',0,0)`, [project, scope.subtitleCode, identity.line])
    await db.query(`update weld_joints set line=$1,line_program_id=(select id from line_programs where project_title=$2 and subtitle_code=$3 and line=$1) where id=$4`,
      [b.line, project, scope.subtitleCode, repair.id])
  })
  // A legacy namesake supplies the normal operator's base-card entry point for
  // B's complete nominal chain; the repair retains its authoritative root in A.
  const namesake = await create({ data: { ...base, ...b, joint: 'ОП-CHAIN', weldLength: '321' } })
  const peer = await create({ data: { ...base, ...b, joint: 'ОП-999', weldLength: '444' } })
  const docId = await withLineProgramFixture(async db => {
    const id = (await db.query("insert into generated_documents(type,title,file_name,mime_type,row_count) values('weldingJournal','TOP race document','race.html','text/html',5) returning id")).rows[0].id
    await db.query('insert into generated_document_weld_joints(document_id,weld_joint_id) select $1,unnest($2::int[])', [id, [...rows.map(row => row.id), namesake.id, peer.id]])
    return id as number
  })
  const document = () => withE2eDatabase(async db => (await db.query(`select d.id,d.type,d.title,d.file_name,d.mime_type,d.row_count,
    array_agg(a.weld_joint_id order by a.weld_joint_id) members from generated_documents d
    join generated_document_weld_joints a on a.document_id=d.id where d.id=$1 group by d.id`, [docId])).rows[0])
  const values = () => withE2eDatabase(async db => (await db.query('select id,line,weld_length::text from weld_joints where id=any($1::int[]) order by id', [rows.map(row => row.id)])).rows)
  const dirtyLines = () => withE2eDatabase(async db => {
    const dirty = JSON.parse((await db.query('select dirty_scopes from dispatcher_task_index_state where id=1')).rows[0].dirty_scopes) as Array<{ projectTitle?: string; line?: string }>
    return [...new Set(dirty.filter(item => item.projectTitle === project).map(item => item.line))].sort()
  })
  const rpc = await supportRaceRpc(page)
  const plan = async () => {
    const preview = await rpc<PstoWeldLineMovePreview>('getPstoWeldLineMovePreview', { rowId: namesake.id, targetIdentity: c })
    expect(preview.isChainMove).toBe(true)
    expect([...preview.expectedRowIds].sort((a, b) => a - b)).toEqual([repair.id, namesake.id].sort((a, b) => a - b))
    return { id: namesake.id, line: c.line, mutationScope: 'welding',
      expectedVersion: preview.expectedVersions.find(row => row.id === namesake.id)!.version,
      weldChainLineMovePlan: { expectedRowIds: preview.expectedRowIds, expectedVersions: preview.expectedVersions, decisions: [] } }
  }
  const initialPlan = await plan(), version = (await stored(original.id)).version
  await ensureDispatcherTaskIndexFresh()
  const beforeFacts = await chainFacts(), beforeDocument = await document(), beforePeer = await stored(peer.id)
  const length = '1000.111222333444555666'
  const setLength = () => rpc('updateWeldJoint', { id: original.id, expectedVersion: version, weldLength: length })
  const move = () => rpc('moveWeldJointChain', initialPlan)
  const settled = await orderedSupportRace(moveFirst ? namesake.id : original.id, moveFirst ? move : setLength, moveFirst ? setLength : move)
  expect(settled.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  expect(String((settled[1] as PromiseRejectedResult).reason)).toMatch(moveFirst ? /Состав или расположение ремонтной цепочки изменились/ : /измен|устар|верс/i)
  const intermediate = await values()
  expect(intermediate.map(row => row.weld_length)).toEqual(Array(3).fill(moveFirst ? base.weldLength : length))
  expect(intermediate.find(row => row.id === repair.id)!.line).toBe(moveFirst ? c.line : b.line)
  expect(await dirtyLines()).toEqual((moveFirst ? [b.line, c.line] : [scope.line, b.line]).sort())
  expect(await chainFacts()).toEqual(beforeFacts)
  expect(await document()).toEqual(beforeDocument)
  expect(await stored(peer.id)).toEqual(beforePeer)
  expect((await stored(namesake.id)).record.weld_length).toBe('321')
  await ensureDispatcherTaskIndexFresh()
  // Refresh only the rejected operation's evidence, then exercise its normal API.
  if (moveFirst) await rpc('updateWeldJoint', { id: original.id, expectedVersion: (await stored(original.id)).version, weldLength: length })
  else await rpc('moveWeldJointChain', await plan())
  const final = await values()
  expect(final.map(row => row.weld_length)).toEqual(Array(3).fill(length))
  expect(final.find(row => row.id === repair.id)!.line).toBe(c.line)
  expect(await dirtyLines()).toEqual((moveFirst ? [scope.line, c.line] : [b.line, c.line]).sort())
  expect(await chainFacts()).toEqual(beforeFacts)
  expect(await document()).toEqual(beforeDocument)
  expect(await stored(peer.id)).toEqual(beforePeer)
  expect((await stored(namesake.id)).record.weld_length).toBe('321')
  const stableRoot = await withE2eDatabase(async db => (await db.query('select physical_root_id from weld_joint_program_states where weld_joint_id=$1', [repair.id])).rows[0].physical_root_id)
  expect(stableRoot).toBe(original.id)
})

async function supportRaceRpc(page: Page) {
  const requestSeen = page.waitForRequest(request => request.url().includes('/_serverFn/'))
  await page.goto('/journal')
  const observed = (await requestSeen).url(), request = page.request
  expect(decodeURIComponent(new URL(observed).pathname.split('/_serverFn/')[1]), 'Use the isolated local production build').toMatch(/^[a-f0-9]{64}$/)
  // Close the live page before observing dirty scopes; both operators use its
  // authenticated HTTP client without background report refreshes consuming them.
  await page.close()
  return async <T = unknown>(name: string, data: unknown): Promise<T> => {
    const response = await request.post(siblingRpcUrl(observed, `${name}_createServerFn_handler`), {
      data: await serializeRpcData(data), headers: { origin: new URL(observed).origin, 'sec-fetch-site': 'same-origin',
        'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    })
    const payload = await deserializeRpcResponse(await response.text()) as { result: T; error?: Error }
    if (payload.error) throw payload.error
    expect(response.ok()).toBe(true)
    return payload.result
  }
}

async function orderedSupportRace(lockedRowId: number, first: () => Promise<unknown>, second: () => Promise<unknown>) {
  let release!: () => void, ready!: (pid: number) => void
  const gate = new Promise<void>(resolve => { release = resolve }), locked = new Promise<number>(resolve => { ready = resolve })
  const holder = withE2eDatabase(async db => {
    await db.query('begin')
    try {
      await db.query('select id from weld_joints where id=$1 for update', [lockedRowId])
      ready((await db.query('select pg_backend_pid() pid')).rows[0].pid)
      await gate
    } finally { await db.query('rollback') }
  })
  const pending: Array<Promise<PromiseSettledResult<unknown>>> = []
  const start = (run: () => Promise<unknown>) => pending.push(run().then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })))
  try {
    const pid = await Promise.race([locked, holder.then(() => { throw new Error('Lock holder stopped before readiness') })])
    const waiting = () => withE2eDatabase(async db => Number((await db.query(`with recursive waiting(pid) as (
      select pid from pg_stat_activity where datname=current_database() and $1::int=any(pg_blocking_pids(pid))
      union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid)) where a.datname=current_database())
      select count(*) n from waiting`, [pid])).rows[0].n))
    start(first)
    await expect.poll(waiting).toBe(1)
    start(second)
    await expect.poll(waiting).toBe(2)
  } finally {
    release()
    await Promise.allSettled([holder, ...pending])
  }
  await holder
  return Promise.all(pending)
}

test('R13 вместо катушки: D57 допускает ремонт, W/Y и отдельная L ремонта блокируются сервером', async () => {
  const rows = await seedChain(12), last = rows.at(-1)!
  await expect(coil({ data: { sourceRowId: last.id, expectedVersion: (await stored(last.id)).version } })).rejects.toThrow('Для Т катушка запрещена')
  await expect(continuation({ data: { source: { id: last.id, version: (await stored(last.id)).version }, targetJoints: ['ОП-CHAINY1', 'ОП-CHAINY2'] } })).rejects.toThrow()
  const [created] = await continuation({ data: { source: { id: last.id, version: (await stored(last.id)).version }, targetJoints: ['ОП-CHAINR13'] } })
  expect((await stored(created.id)).record).toMatchObject({ joint: 'ОП-CHAINR13', weld_length: '600.123456789123456789', has_uzk: 'да', has_rk: null, weld_date: null })
  await expect(update({ data: { id: created.id, expectedVersion: (await stored(created.id)).version, weldLength: 100 } })).rejects.toThrow('Длина ремонта наследуется')
})

async function seedChain(repairs: number) {
  const original = await create({ data: { ...base, joint: 'ОП-CHAIN', hasUzk: 'да' } })
  await withLineProgramFixture(async db => {
    await db.query(`update weld_joints set vik_result='годен',vik_request='TOP-V',vik_request_date='2026-07-01',vik_conclusion='TOP-VC',vik_conclusion_date='2026-07-01',
      uzk_result='ремонт',uzk_request='TOP-U',uzk_request_date='2026-07-01',uzk_conclusion='TOP-UC',uzk_conclusion_date='2026-07-01',final_status='не годен' where id=$1`, [original.id])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,welding_method,material_group,d1,t1,weld_length,weld_date,
      stamp_1_k,stamp_1_z,has_vik,has_uzk,vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,final_status)
      select line_program_id,project_title,subtitle_code,line,joint||'R'||n,'Т1',welding_method,material_group,d1,t1,weld_length,weld_date,
      stamp_1_k,stamp_1_z,'да','да',vik_result,vik_request,vik_request_date,vik_conclusion,vik_conclusion_date,uzk_result,uzk_request,uzk_request_date,uzk_conclusion,uzk_conclusion_date,final_status
      from weld_joints cross join generate_series(1,$2::int) n where id=$1`, [original.id, repairs])
  })
  await ensureDispatcherTaskIndexFresh()
  return withE2eDatabase(async db => (await db.query('select id,joint from weld_joints where project_title=$1 order by id', [project])).rows as Array<{ id: number; joint: string }>)
}
const lengths = () => withE2eDatabase(async db => (await db.query('select weld_length::text from weld_joints where project_title=$1 order by id', [project])).rows.map(row => row.weld_length))
const chainFacts = () => withE2eDatabase(async db => (await db.query('select id,joint,vik_result,vik_request,vik_conclusion,uzk_result,uzk_request,uzk_conclusion from weld_joints where project_title=$1 order by id', [project])).rows)

test('UI: смена С → Т сохраняет видимые несовместимые значения, блокирует сохранение и выбор новых сочетаний', async ({ page }) => {
  await page.goto('/journal')
  await page.getByRole('button', { name: 'Новый стык', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: 'Стык', exact: true }).fill('ОП-901')
  await editor.getByRole('combobox', { name: 'Тип соединения', exact: true }).selectOption('С17')
  const materials = editor.getByRole('group', { name: 'Группа материалов', exact: true })
  const methods = editor.getByRole('group', { name: 'Способ сварки', exact: true })
  for (const material of ['М01', 'М05']) await materials.getByRole('button', { name: material, exact: true }).click()
  for (const method of ['РАД', 'РД']) await methods.getByRole('button', { name: method, exact: true }).click()
  await editor.getByRole('combobox', { name: 'Тип соединения', exact: true }).selectOption('Т1')
  for (const material of ['М01', 'М05']) await expect(materials.getByRole('button', { name: material, exact: true })).toHaveAttribute('aria-pressed', 'true')
  for (const method of ['РАД', 'РД']) await expect(methods.getByRole('button', { name: method, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  await expect(editor.getByText(/Для Т разнородное соединение запрещено/)).toBeVisible()
  await materials.getByRole('button', { name: 'М05', exact: true }).click()
  await methods.getByRole('button', { name: 'РД', exact: true }).click()
  await expect(materials.getByRole('button', { name: 'М05', exact: true })).toBeDisabled()
  await expect(methods.getByRole('button', { name: 'РД', exact: true })).toBeDisabled()
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
})

test('Т: сервер, массовое обновление и импорт запрещают два материала/способа после слияния, вся операция откатывается', async () => {
  const original = await create({ data: { ...base, joint: 'ОП-902' } })
  const peer = await create({ data: { ...base, joint: 'ОП-903' } })
  const before = await stored(original.id), peerBefore = await stored(peer.id)
  const invalid = { id: original.id, materialGroup: 'М01 + М05', weldingMethod: 'РАД+РД' }
  for (const write of [
    () => update({ data: { ...invalid, expectedVersion: before.version } }),
    () => batch({ data: { records: [{ id: peer.id, weldingJournalNote: 'ROLLBACK' }, invalid], expectedVersions: [{ id: original.id, version: before.version }, { id: peer.id, version: peerBefore.version }] } }),
    () => replace({ data: { records: [invalid], deleteIds: [peer.id], expectedVersions: [{ id: original.id, version: before.version }, { id: peer.id, version: peerBefore.version }] } }),
    () => importRows({ data: { records: [{ ...base, joint: 'ОП-904', materialGroup: invalid.materialGroup, weldingMethod: invalid.weldingMethod }] } }),
  ]) await expect(write()).rejects.toThrow(/разнородное.*комбинированная/s)
  expect(await stored(original.id)).toEqual(before)
  expect(await stored(peer.id)).toEqual(peerBefore)
})

test('возврат официальности: предпросмотр объясняет недостающий УЗК, сохранение перестраивает цепочку без автозаполнения', async () => {
  const source = await create({ data: { ...base, joint: 'ОП-905', hasUzk: 'да' } })
  await withLineProgramFixture(db => db.query("update weld_joints set officiality='неофициальный',uzk_result='ремонт',uzk_request='RESTORE-U',uzk_request_date='2026-07-02',uzk_conclusion='RESTORE-C',uzk_conclusion_date='2026-07-03' where id=$1", [source.id]))
  const replacement = await create({ data: { ...base, joint: 'ОП-905', hasUzk: null } })
  const targets = await versions([source.id])
  const data = { targets, officiality: 'official' as const }
  const plan = await officialityPreview({ data })
  expect(plan.missingControlAssignments).toContainEqual({ rowId: replacement.id, joint: 'ОП-905R1', methods: ['УЗК'] })
  expect((await stored(replacement.id)).record.joint).toBe('ОП-905')
  await officialityApply({ data: { ...data, expectedPlanKey: plan.planKey } })
  expect((await stored(replacement.id)).record).toMatchObject({ joint: 'ОП-905R1', has_uzk: null })
  expect((await stored(source.id)).record).toMatchObject({ officiality: null, uzk_result: 'ремонт', uzk_conclusion: 'RESTORE-C' })
})
