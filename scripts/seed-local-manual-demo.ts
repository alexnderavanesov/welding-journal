import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { eq, sql } from 'drizzle-orm'
import { loadServerEnv } from '../src/server-env'
import type { WeldRow } from '../src/lib/dispatcher-types'
import type { NewPreHeatTreatmentControl, NewDuplicateControl, NewPstoRepeatCycle } from '../src/db/schema'
import { calculateFinalStatus } from '../src/lib/weld-status'
import { getWeldFormSaveBlockReason } from '../src/lib/weld-form-save-reasons'
import { getLineProgramConfigurationIssue } from '../src/lib/line-program'
import { buildRepeatedJointTasks } from '../src/lib/repeated-joint-tasks'
import { getDispatcherTaskCode } from '../src/lib/dispatcher-settings'

// Explicitly local, append-only manual fixtures. Not a migration or a production importer.
loadServerEnv()
const target = new URL(process.env.DATABASE_URL ?? '')
assert(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432', 'Only local PostgreSQL is allowed')
const checkDatabases = ['/welding_tracker_line_program_test_20260926', '/welding_tracker_e2e']
assert(target.pathname === '/welding_tracker' || checkDatabases.includes(target.pathname), 'Unexpected local database')
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'main')
const apply = process.argv.includes('--apply-local')
assert(apply || (process.argv.includes('--check') && checkDatabases.includes(target.pathname)), 'Use --apply-local; rollback checks are test-DB-only')
const PROJECT = 'Демо — 50 стыков'
const SUBTITLE = 'DEMO-50-2026'
const [{ requireDb }, schema, persistence, validation, layered, dirty] = await Promise.all([
  import('../src/db/index'), import('../src/db/schema'), import('../src/server/weld-persistence'),
  import('../src/server/weld-save-validation'), import('../src/server/layered-control-documents'),
  import('../src/server/dispatcher-task-index-dirty'),
])
const db = requireDb()
const { weldJoints, linePrograms, welderStamps, preHeatTreatmentControls, duplicateControls, pstoRepeatCycles, generatedDocumentWeldJoints } = schema
type Fixture = {
  row: WeldRow
  pre: Omit<NewPreHeatTreatmentControl, 'weldJointId'>[]
  duplicates: Omit<NewDuplicateControl, 'weldJointId'>[]
  repeats: Omit<NewPstoRepeatCycle, 'weldJointId'>[]
}
const percentages = [[0, 0], [1, 1], [2.5, 1], [10, 5], [30, 10], [100, 20], [100, 100], [30, 10], [50, 20], [5, 2.5]]
const fixtures: Fixture[] = Array.from({ length: 50 }, (_, offset) => {
  const n = offset + 1
  const group = Math.floor(offset / 5)
  const diameter = [108, 159, 219, 325, 530][offset % 5]
  const thickness = [4, 6, 8, 10, 12][offset % 5]
  const withPsto = [3, 4, 6].includes(group)
  const stamp = group === 7 ? 'D504' : `D50${group % 3 + 1}`
  return { pre: [], duplicates: [], repeats: [], row: {
    id: n, projectTitle: PROJECT, subtitleCode: SUBTITLE, line: `DEMO-L${String(group + 1).padStart(2, '0')}`,
    joint: `F${n}`, weldDate: `2026-09-0${offset % 5 + 1}`, category: group === 9 ? null : group === 5 || group === 6 ? 'I' : 'II',
    groupName: 'Б(а)', weldControlPercent: percentages[group][0], pvkControlPercent: percentages[group][1],
    isometry: `DEMO-ISO-${String(group + 1).padStart(2, '0')}`, sheet: 1, revisionNumber: 0,
    spool: `SPL-${String(Math.ceil(n / 3)).padStart(2, '0')}`, officiality: 'действующий', revisionActuality: 'актуальная',
    weldingMethod: n % 2 ? 'РД' : 'РАД', connectionType: group === 8 || n % 5 === 0 ? 'У19' : 'С17',
    materialGroup: withPsto ? 'М05' : n % 3 === 0 ? 'М11' : 'М01',
    d1: diameter, d2: diameter, t1: thickness, t2: thickness, wdi: Number((diameter / 25.4).toFixed(3)),
    material1: withPsto ? '15Х5М' : n % 3 === 0 ? '12Х18Н10Т' : '20',
    material2: withPsto ? '15Х5М' : n % 3 === 0 ? '12Х18Н10Т' : '20',
    element1: 'Труба', element2: group === 8 ? 'Штуцер' : n % 4 === 0 ? 'Отвод 90°' : 'Труба',
    materialCertificateNumber1: `DEMO-СЕРТ-${group + 1}-01`, materialCertificateNumber2: `DEMO-СЕРТ-${group + 1}-02`,
    responsible: 'Мастер тестового участка', technologyCardNumber: `ТК-DEMO-${n % 2 + 1}`,
    ...(n % 2 ? { weldingElectrodes: 'УОНИ-13/55', weldingElectrodesCertificateNumber: 'DEMO-Э-001' }
      : { fillerWire: 'Св-08Г2С', fillerWireCertificateNumber: 'DEMO-П-001', shieldingGas: 'Аргон', shieldingGasCertificateNumber: 'DEMO-Г-001' }),
    stamp1K: stamp, stamp1Z: stamp, stamp1O: stamp, stamp1KFact: stamp, stamp1ZFact: stamp, stamp1OFact: stamp,
    hasVik: 'да', vikControlBasis: 'Проект', pstoRequired: withPsto ? 'да' : null,
    pstoControlBasis: withPsto ? 'Проект, термообработка после сварки' : null,
  } }
})
const f = (n: number) => fixtures[n - 1]
function note(n: number, value: string) { f(n).row.weldingJournalNote = `Тестовый пример: ${value}` }
type Method = 'vik' | 'rk' | 'uzk' | 'pvk'
const codes = { vik: 'ВИК', rk: 'РК', uzk: 'УЗК', pvk: 'ПВК' }
function lnk(n: number, method: Method, result?: string) {
  const row = f(n).row
  const enabledKey = { vik: 'hasVik', rk: 'hasRk', uzk: 'hasUzk', pvk: 'hasPvk' }[method]
  Object.assign(row, { [enabledKey]: 'да', [`${method}ControlBasis`]: 'Проект',
    [`${method}Request`]: `Заявка ${codes[method]} DEMO-${n}`, [`${method}RequestDate`]: '2026-09-15',
    [`${method}Result`]: result ?? 'ожидает НК',
    ...(result ? { [`${method}Conclusion`]: `Заключение ${codes[method]} DEMO-${n}`,
      [`${method}ConclusionDate`]: method === 'vik' ? '2026-09-16' : '2026-09-17',
      [method === 'rk' ? 'lnkDefectDescription' : `${method}DefectDescription`]: result === 'годен' ? 'ДНО' : 'Несплавление, участок 25 мм',
    } : {}), ...(method === 'rk' && result ? { rkExposureConfirmedDiameter: row.d1 } : {}) })
}
function pre(n: number, method: Method, result?: string) {
  const row = f(n).row
  Object.assign(row, { [{ vik: 'hasVik', rk: 'hasRk', uzk: 'hasUzk', pvk: 'hasPvk' }[method]]: 'да' })
  f(n).pre.push({ method: codes[method], requestName: `Заявка до ТО ${codes[method]} DEMO-${n}`, requestDate: '2026-09-06',
    result: result ?? 'ожидает НК', ...(result ? { conclusionName: `Заключение до ТО ${codes[method]} DEMO-${n}`,
      conclusionDate: method === 'vik' ? '2026-09-07' : '2026-09-08', defectDescription: result === 'годен' ? 'ДНО' : 'Несплавление',
      ...(method === 'rk' ? { rkExposureConfirmedDiameter: Number(row.d1) } : {}) } : {}) })
}
function psto(n: number, stage: 'request' | 'done' | 'tvmt-request' | 'tvmt-good' | 'tvmt-bad') {
  const row = f(n).row
  pre(n, 'vik', 'годен')
  // Pre-TO covers every assigned method, but never creates a primary result.
  for (const method of ['rk', 'uzk', 'pvk'] as const) {
    if (row[({ rk: 'hasRk', uzk: 'hasUzk', pvk: 'hasPvk' } as const)[method]] === 'да') pre(n, method, 'годен')
  }
  Object.assign(row, { pstoRequest: `Заявка ПСТО DEMO-${n}`, pstoRequestDate: '2026-09-09' })
  if (stage === 'request') return
  Object.assign(row, { pstoResult: 'проведено', pstoDate: '2026-09-10', heatTreatmentDiagram: `Диаграмма DEMO-${n}` })
  if (stage === 'done') return
  Object.assign(row, { tvmtRequest: `Заявка ТВМТ DEMO-${n}`, tvmtRequestDate: '2026-09-11' })
  if (stage === 'tvmt-request') return
  Object.assign(row, { tvmtResult: stage === 'tvmt-good' ? 'годен' : 'не годен', tvmtConclusionDate: '2026-09-12', tvmtConclusion: `Заключение ТВМТ DEMO-${n}` })
}

for (const n of [1, 2]) {
  Object.assign(f(n).row, { weldDate: null, stamp1K: null, stamp1Z: null, stamp1O: null, stamp1KFact: null, stamp1ZFact: null, stamp1OFact: null })
  note(n, 'сборка, сварка ещё не выполнена')
}
note(3, 'сварен, ожидает заявку ВИК'); lnk(4, 'vik'); note(4, 'заявка ВИК создана, результат ожидается')
lnk(5, 'vik', 'годен'); note(5, 'линия 0%, ВИК завершён')
for (const n of [6, 7, 8, 9, 10, 11, 12, 13, 14]) lnk(n, 'vik', 'годен')
lnk(6, 'rk', 'годен'); note(6, '1%: обязательный РК выполнен')
lnk(7, 'rk', 'ремонт'); note(7, '1%: негодный РК, добор +1 и создание ремонта')
lnk(8, 'pvk', 'ремонт'); note(8, '1%: негодный ПВК теряет зачёт ПВК, но не увеличивает добор РК/УЗК')
f(9).row.hasUzk = 'да'; note(9, 'назначен УЗК, заявка ещё не создана')
Object.assign(f(10).row, { connectionType: 'С17', hasRk: 'отменен', hasUzk: 'отменен', rkControlBasis: 'Решение тестового контроля', uzkControlBasis: 'Решение тестового контроля' }); note(10, 'совместная осознанная отмена РК+УЗК для С')
lnk(11, 'rk', 'годен'); lnk(11, 'uzk', 'годен'); note(11, 'ДЗ-27: два взаимозаменяемых обязательных метода')
lnk(12, 'rk', 'годен'); f(12).row.hasRk = 'дополнительный'; note(12, 'дополнительный РК выполнен, закрывает норму и не предлагается к снятию как обычное лишнее назначение')
Object.assign(f(13).row, { stamp2K: 'D503', stamp2Z: 'D503', stamp2O: 'D503', stamp2KFact: 'D503', stamp2ZFact: 'D503', stamp2OFact: 'D503' }); note(13, 'стык двух клейм, общий контроль ещё не назначен')
lnk(14, 'rk', 'годен'); f(14).duplicates.push({ method: 'РК', result: 'ремонт', controlDate: '2026-09-19', conclusionDate: '2026-09-19', conclusion: 'Дубль РК DEMO-14' }); note(14, 'основной РК годен, дубль негоден: контроль дубля и ремонт')
lnk(15, 'vik', 'вырез'); note(15, 'негодный ВИК, требуется вырез и новый стык')
note(16, 'ПСТО назначена; НК до ТО ещё не начат'); pre(17, 'vik'); note(17, 'ожидание результата ВИК до ТО')
pre(18, 'vik', 'годен'); note(18, 'ВИК до ТО завершён, можно создавать заявку ПСТО')
psto(19, 'request'); note(19, 'заявка ПСТО создана, обработка ожидается')
psto(20, 'done'); note(20, 'ПСТО выполнена, нужна заявка ТВМТ')
f(21).row.hasRk = 'да'; psto(21, 'tvmt-request'); note(21, 'ожидание результата ТВМТ')
f(22).row.hasRk = 'да'; psto(22, 'tvmt-good'); lnk(22, 'vik', 'годен'); lnk(22, 'rk'); note(22, 'ПСТО и ТВМТ завершены, основной РК ожидается')
f(23).row.hasPvk = 'да'; psto(23, 'tvmt-good'); lnk(23, 'vik', 'годен'); lnk(23, 'pvk', 'годен'); note(23, 'ПВК выполнен на двух этапах, в охвате считается один стык')
psto(24, 'tvmt-bad'); note(24, 'негодная ТВМТ, требуется повторная ПСТО')
psto(25, 'tvmt-bad'); f(25).repeats.push({ sequence: 2, pstoRequest: 'Заявка ПСТО повтор DEMO-25', pstoRequestDate: '2026-09-13' }); note(25, 'после негодной ТВМТ уже открыта заявка повторной ПСТО')
for (const n of [26, 27, 28, 29]) lnk(n, 'vik', 'годен')
lnk(26, 'rk', 'годен'); lnk(26, 'pvk', 'годен'); note(26, '100%: РК и ПВК завершены')
lnk(27, 'rk', 'ремонт'); note(27, '100%: негодный РК и задача ремонта')
lnk(28, 'uzk', 'вырез'); note(28, '100%: негодный УЗК и задача выреза')
lnk(29, 'pvk', 'годен'); lnk(29, 'rk'); note(29, 'ВИК и ПВК годны, ожидается результат РК')
f(30).row.hasRk = 'да'; lnk(30, 'vik'); note(30, '100%: основная заявка ВИК, РК назначен')
lnk(31, 'vik', 'годен'); note(31, 'СП-01: основной ВИК уже выполнен, но НК до ТО/ПСТО/ТВМТ ещё не пройдены')
f(32).row.hasRk = 'да'; f(32).row.hasPvk = 'да'; psto(32, 'request'); note(32, '100%: все назначенные методы до ТО выполнены, ожидается ПСТО')
f(33).row.hasUzk = 'да'; f(33).row.hasPvk = 'да'; psto(33, 'tvmt-bad'); note(33, '100%: негодная ТВМТ, основные методы ещё не начаты')
psto(34, 'tvmt-good'); lnk(34, 'vik', 'ремонт'); note(34, 'негодный основной ВИК после завершённой ПСТО')
f(35).row.hasRk = 'да'; f(35).row.hasPvk = 'да'; psto(35, 'tvmt-good'); lnk(35, 'vik', 'годен'); lnk(35, 'rk', 'годен'); lnk(35, 'pvk', 'годен'); note(35, 'полностью завершены оба этапа, ПСТО и ТВМТ')
lnk(36, 'vik', 'годен'); lnk(36, 'rk', 'ремонт'); note(36, 'D504: первый первичный негодный РК/УЗК — РК')
lnk(37, 'vik', 'годен'); lnk(37, 'rk', 'ремонт'); note(37, 'D504: второй негодный — РК')
lnk(38, 'vik', 'годен'); lnk(38, 'uzk', 'вырез'); note(38, 'D504: третий негодный — УЗК')
lnk(39, 'vik', 'годен'); lnk(39, 'rk', 'ремонт'); note(39, 'D504: четвёртый первичный негодный РК/УЗК — РК; ДЗ-05/06, полный контроль и решение об отстранении')
lnk(40, 'vik', 'годен'); note(40, 'D504: доступный стык для полного контроля после четырёх негодных')
lnk(41, 'vik', 'годен'); lnk(41, 'pvk', 'годен'); f(41).row.layeredControlAssigned = true; note(41, 'явный послойный У: ПВК выполнен, создан комплект четырёх документов')
Object.assign(f(42).row, { hasPvk: 'да', layeredControlAssigned: true }); lnk(42, 'vik', 'годен'); note(42, 'послойный У назначен, ПВК ещё не выполнен, комплекта пока нет')
lnk(43, 'vik', 'годен'); lnk(43, 'pvk', 'годен'); note(43, 'обычный ПВК на У без послойного назначения')
lnk(44, 'vik', 'годен'); lnk(44, 'rk', 'годен'); f(44).duplicates.push({ method: 'РК', result: 'годен', controlDate: '2026-09-19', conclusionDate: '2026-09-19', conclusion: 'Дубль РК DEMO-44' }); note(44, 'основной и дублирующий РК годны')
lnk(45, 'vik', 'годен'); lnk(45, 'pvk', 'годен'); f(45).row.hasPvk = 'отменен'; note(45, 'ПВК отменён после выполнения: собственный факт остаётся в охвате')
for (let n = 46; n <= 50; n++) {
  Object.assign(f(n).row, { pstoRequired: 'отменен', pstoCancellationDate: '2026-09-14', pstoControlBasis: 'Решение DEMO-ПСТО-10 от 14.09.2026' })
  lnk(n, 'vik', 'годен'); note(n, 'СП-02: у линии намеренно не заполнена категория; ПСТО отменена до начала работ')
}
lnk(46, 'rk', 'годен'); lnk(47, 'uzk'); f(48).row.hasPvk = 'дополнительный'; lnk(49, 'pvk', 'годен')
Object.assign(f(50).row, { testTypes: 'ГИ', testContour: 'DEMO-КОНТУР-10', testDate: '2026-09-20' })

class RollbackCheck extends Error {}
let summary: unknown
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROJECT}))`)
    const existing = await tx.select({ id: weldJoints.id, joint: weldJoints.joint }).from(weldJoints).where(eq(weldJoints.projectTitle, PROJECT))
    if (existing.length) {
      assert.equal(existing.length, 50, 'Partial demo already exists: refusing to overwrite user edits')
      assert.deepEqual(existing.map((r) => r.joint).sort(), fixtures.map((r) => r.row.joint).sort())
      summary = { skipped: true, project: PROJECT, rows: existing.length }
      return
    }
    const before = await tx.select().from(weldJoints)
    const stamps = ['D501', 'D502', 'D503', 'D504']
    for (const stamp of stamps) {
      assert.equal((await tx.select({ id: welderStamps.id }).from(welderStamps).where(eq(welderStamps.naksStamp, stamp))).length, 0, 'Demo stamp already used')
    }
    await tx.insert(welderStamps).values(stamps.map((stamp, i) => ({
      naksStamp: stamp, internalStamp: `Д-${i + 1}`, welderName: `Демонстрационный сварщик ${i + 1}`, weldType: 'РД, РАД',
      materialGroups: 'М01, М05, М11', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50',
      validFrom: '2026-01-01', validTo: '2027-12-31',
      naksPermits: JSON.stringify(['РД', 'РАД'].map((weldType) => ({ id: `demo-${stamp}-${weldType}`, weldType,
        materialGroups: 'М01, М05, М11', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31', note: 'Синтетический допуск для локальных тестов' }))),
      dlsPermits: JSON.stringify(['РД', 'РАД'].map((weldType) => ({ id: `demo-dls-${stamp}-${weldType}`, number: `DEMO-ДЛС-${stamp}-${weldType}`, weldType,
        materialGroups: 'М01, М05, М11', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31', note: 'Синтетический допуск для локальных тестов' }))),
    })))
    const programs = await tx.insert(linePrograms).values(percentages.map(([weldControlPercent, pvkControlPercent], index) => {
      const sample = fixtures[index * 5].row
      const properties = { category: sample.category == null ? null : String(sample.category), groupName: String(sample.groupName), weldControlPercent, pvkControlPercent }
      return { projectTitle: PROJECT, subtitleCode: SUBTITLE, line: String(sample.line), ...properties, configurationIssue: getLineProgramConfigurationIssue(properties) }
    })).returning()
    if (!apply) {
      // Match the already enabled local setting only inside the rollback test.
      const value = JSON.stringify({ preHeatTreatmentLnkEnabled: true, allowPrimaryLnkBeforePreviousStagesComplete: true, pvkGoodOnly: false })
      await tx.insert(schema.appSettings).values({ key: 'control-processes', value })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
    }
    const context = await validation.loadServerWeldValidationContext(tx, fixtures.map((v) => v.row))
    assert(context.controlProcessSettings.preHeatTreatmentLnkEnabled, 'Enable pre-TO before using these manual scenarios')
    assert(context.controlProcessSettings.allowPrimaryLnkBeforePreviousStagesComplete, 'SP-01 scenario needs the existing early-primary setting')
    assert(!context.controlProcessSettings.pvkGoodOnly, 'Rejected PVK scenarios require PVK-good-only to remain off')
    for (const fixture of fixtures) {
      const row = fixture.row
      row.preHeatTreatmentLnkEnabled = true
      row.preHeatTreatmentControls = fixture.pre.map((v, i) => ({ ...v, id: i + 1, weldJointId: row.id }))
      row.duplicateControls = fixture.duplicates.map((v, i) => ({ ...v, id: i + 1, weldJointId: row.id })) as WeldRow['duplicateControls']
      row.pstoRepeatCycles = fixture.repeats.map((v, i) => ({ ...v, id: i + 1, weldJointId: row.id }))
      assert.equal(getWeldFormSaveBlockReason(row, {}, context.saveCheckSettings, { allowPrimaryLnkStageDebt: true }), null, String(row.joint))
      assert.equal(validation.getSystemDocumentIntegrityReason(row, undefined), '', String(row.joint))
    }
    const values = fixtures.map(({ row }) => {
      const program = programs.find((p) => p.line === row.line)!
      const value = persistence.toDbInsert({ ...row, lineProgramId: program.id }, true)
      return { ...value, layeredControlAssigned: row.layeredControlAssigned === true, finalStatus: calculateFinalStatus(row) }
    })
    const saved = await tx.insert(weldJoints).values(values).returning()
    const hydrated: WeldRow[] = []
    for (const fixture of fixtures) {
      const row = saved.find((r) => r.joint === fixture.row.joint)!
      const preRows = fixture.pre.length ? await tx.insert(preHeatTreatmentControls).values(fixture.pre.map((v) => ({ ...v, weldJointId: row.id }))).returning() : []
      const dupRows = fixture.duplicates.length ? await tx.insert(duplicateControls).values(fixture.duplicates.map((v) => ({ ...v, weldJointId: row.id }))).returning() : []
      const repeatRows = fixture.repeats.length ? await tx.insert(pstoRepeatCycles).values(fixture.repeats.map((v) => ({ ...v, weldJointId: row.id }))).returning() : []
      hydrated.push({ ...row, preHeatTreatmentControls: preRows, duplicateControls: dupRows, pstoRepeatCycles: repeatRows } as unknown as WeldRow)
    }
    await layered.syncLayeredControlDocumentsForWeldChangesInTransaction(tx, saved, new Map())
    const layeredLinks = await tx.select().from(generatedDocumentWeldJoints).where(eq(generatedDocumentWeldJoints.weldJointId, saved.find((r) => r.joint === 'F41')!.id))
    assert.equal(layeredLinks.length, 4)
    const tasks = buildRepeatedJointTasks(hydrated, context.welderStamps, [], {
      controlProcessSettings: context.controlProcessSettings, dataListSettings: context.dataListSettings,
    })
    const counts: Record<string, number> = {}
    for (const task of tasks) { const code = getDispatcherTaskCode(task); counts[code] = (counts[code] ?? 0) + 1 }
    for (const code of ['СП-01', 'СП-02', 'ДЗ-04', 'ДЗ-05', 'ДЗ-06', 'ДЗ-07', 'ДЗ-27']) assert(counts[code] > 0, `Missing intended scenario ${code}`)
    const unexpected = tasks.filter((task) => getDispatcherTaskCode(task).startsWith('ЗВ-'))
    assert.deepEqual(unexpected.map((task) => ({ code: getDispatcherTaskCode(task), task })), [], 'Fixture must not introduce save-blocking errors')
    const afterOld = (await tx.select().from(weldJoints)).filter((r) => before.some((old) => old.id === r.id))
    assert.deepEqual(afterOld, before, 'Existing rows must stay unchanged')
    await dirty.markDispatcherTaskIndexDirty(tx, { scopes: dirty.getDispatcherDirtyScopes(saved, new Map()) })
    summary = { project: PROJECT, database: target.pathname.slice(1), created: saved.length, preserved: before.length,
      lines: programs.length, stamps: stamps.length, layeredDocuments: layeredLinks.length, tasks: counts,
      scenarios: fixtures.map(({ row }) => ({ joint: row.joint, line: row.line, note: row.weldingJournalNote })) }
    if (!apply) throw new RollbackCheck()
  })
} catch (error) {
  if (!(error instanceof RollbackCheck)) throw error
}
console.log(JSON.stringify({ applied: apply, summary }, null, 2))
