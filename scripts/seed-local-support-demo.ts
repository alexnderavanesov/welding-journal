import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { eq, inArray, sql } from 'drizzle-orm'
import { loadServerEnv } from '../src/server-env'
import type { WeldRow } from '../src/lib/dispatcher-types'
import type { NewPreHeatTreatmentControl, WeldJoint } from '../src/db/schema'
import type { PstoRepeatCycleRecord } from '../src/lib/psto-cycle'
import { checkTechnologyCardApplicability } from '../src/lib/technology-card-matching'
import { calculateFinalStatus } from '../src/lib/weld-status'
import { buildRepeatPstoRequestCycle, buildRepeatPstoResultCycle, buildRepeatTvmtRequestCycle, buildRepeatTvmtResultCycle, type PstoRepeatCycleWrite } from '../src/lib/psto-repeat-cycle-updates'
import { getPstoTvmtWorkflowState } from '../src/lib/tvmt-cycle'
import { buildSystemDocumentSummaries, SYSTEM_DOCUMENT_TYPES } from '../src/lib/system-document-types'
import { buildPrimaryPstoSystemDocumentRow, buildPstoRepeatSystemDocumentRow } from '../src/lib/system-document-virtual-row'

// Explicitly requested persistent local examples. Append only, never a migration.
loadServerEnv()
const target = new URL(process.env.DATABASE_URL ?? '')
assert(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '5432', 'Local PostgreSQL only')
const apply = process.argv.includes('--apply-local'), seedTest = process.argv.includes('--seed-test')
assert(apply ? target.pathname === '/welding_tracker'
  : (seedTest || process.argv.includes('--check')) && target.pathname === '/welding_tracker_e2e', 'Unexpected target/mode')
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'main')
const PROJECT = 'Демо Т/ОП — этапы', SUBTITLE = 'DEMO-T-2026', STAMP = 'DT01', REPAIR_STAMP = 'DT02', CARD = 'ДЕМО-ТК-ОП-2026'
const date = (day: number) => `2026-10-${String(day).padStart(2, '0')}`
const plans = [
  { line: 'ОП-НК', rate: 100, heat: false },
  { line: 'ОП-РЕМОНТ', rate: 100, heat: false },
  { line: 'ОП-ПСТО', rate: 100, heat: true },
  { line: 'ОП-ПРОГРАММА', rate: 50, heat: false },
]
type Fixture = { row: WeldRow; pre: Omit<NewPreHeatTreatmentControl, 'weldJointId'>[]; repeat?: Omit<PstoRepeatCycleRecord, 'id' | 'weldJointId'> }
const fixtures: Fixture[] = []
function add(line: string, joint: string, note: string, overrides: Partial<WeldRow> = {}) {
  const heat = line === 'ОП-ПСТО'
  const row: WeldRow = {
    id: -(fixtures.length + 1), projectTitle: PROJECT, subtitleCode: SUBTITLE, line, joint,
    isometry: `ДЕМО-ИЗО-${line}`, sheet: 1, revisionNumber: 0, category: 'II', groupName: 'Б(а)',
    weldControlPercent: 100, pvkControlPercent: 100, connectionType: 'Т1', weldingMethod: 'РД',
    materialGroup: heat ? 'М05' : 'М01', material1: heat ? '15Х5М' : '20', material2: heat ? '15Х5М' : '20',
    element1: 'Труба', element2: 'Опора', d1: 108, t1: 6, weldLength: '600.125', weldDate: date(12),
    materialCertificateNumber1: 'ДЕМО-СЕРТ-ОП-01', materialCertificateNumber2: 'ДЕМО-СЕРТ-ОП-02',
    weldingElectrodes: 'УОНИ-13/55', weldingElectrodesCertificateNumber: 'ДЕМО-Э-ОП-01',
    stamp1K: STAMP, stamp1KFact: STAMP,
    hasVik: 'да', hasPvk: 'да', hasUzk: 'да', vikControlBasis: 'Демонстрационная программа',
    pvkControlBasis: 'Демонстрационная программа', uzkControlBasis: 'Демонстрационная программа',
    pstoRequired: heat ? 'да' : null, pstoControlBasis: heat ? 'Демонстрационная программа ПСТО' : null,
    technologyCardNumber: `${CARD}-${heat ? 'М05' : 'М01'}`, responsible: 'Демонстрационный участок',
    weldingJournalNote: `ДЕМО: ${note}`, ...overrides,
  }
  const fixture = { row, pre: [] } as Fixture
  fixtures.push(fixture)
  return fixture
}
function unwelded(f: Fixture) {
  Object.assign(f.row, { weldDate: null, stamp1K: null, stamp1KFact: null, technologyCardNumber: null })
  return f
}
type Method = 'vik' | 'pvk' | 'uzk'
const codes = { vik: 'ВИК', pvk: 'ПВК', uzk: 'УЗК' }
function nk(f: Fixture, method: Method, result?: 'годен' | 'ремонт', day = 13, pre = false) {
  const request = `ДЕМО-ОП-${pre ? 'ДО-ТО-' : ''}${codes[method]}-${f.row.joint}`
  if (pre) f.pre.push({ method: codes[method], requestName: request, requestDate: date(day), result: result ?? 'ожидает НК',
    ...(result ? { conclusionName: `${request}-ЗАКЛ`, conclusionDate: date(day + 1), defectDescription: result === 'годен' ? 'ДНО' : 'Демонстрационный дефект' } : {}) })
  else Object.assign(f.row, { [`${method}Request`]: request, [`${method}RequestDate`]: date(day), [`${method}Result`]: result ?? 'ожидает НК',
    ...(result ? { [`${method}Conclusion`]: `${request}-ЗАКЛ`, [`${method}ConclusionDate`]: date(day + 1), [`${method}DefectDescription`]: result === 'годен' ? 'ДНО' : 'Демонстрационный дефект' } : {}) })
  return f
}
function completeNk(f: Fixture, pre = false, start = 13) {
  nk(f, 'vik', 'годен', start, pre); nk(f, 'pvk', 'годен', start + 1, pre); nk(f, 'uzk', 'годен', start + 2, pre)
  return f
}
function heat(f: Fixture, stage: 'request' | 'done' | 'tvmt-request' | 'good' | 'bad') {
  completeNk(f, true)
  Object.assign(f.row, { pstoRequest: `ДЕМО-ОП-ПСТО-${f.row.joint}`, pstoRequestDate: date(17) })
  if (stage === 'request') return f
  Object.assign(f.row, { pstoResult: 'проведено', pstoDate: date(18), heatTreatmentDiagram: `ДЕМО-ОП-ДИАГРАММА-${f.row.joint}` })
  if (stage === 'done') return f
  Object.assign(f.row, { tvmtRequest: `ДЕМО-ОП-ТВМТ-${f.row.joint}`, tvmtRequestDate: date(19) })
  if (stage === 'tvmt-request') return f
  Object.assign(f.row, { tvmtResult: stage === 'good' ? 'годен' : 'не годен', tvmtConclusion: `ДЕМО-ОП-ТВМТ-${f.row.joint}-ЗАКЛ`, tvmtConclusionDate: date(20) })
  return f
}

unwelded(add('ОП-НК', 'ОП-01', 'Сборка: опора ещё не сварена. Заполните дату и клеймо.'))
add('ОП-НК', 'ОП-02', 'Сварено: предстоит создать заявку ВИК.')
nk(add('ОП-НК', 'ОП-03', 'Создана заявка ВИК; результат ожидается.'), 'vik')
nk(add('ОП-НК', 'ОП-04', 'ВИК годен; следующий этап — заявка ПВК.'), 'vik', 'годен')
nk(nk(add('ОП-НК', 'ОП-05', 'ВИК годен, заявка ПВК создана; результат ожидается.'), 'vik', 'годен'), 'pvk', undefined, 14)
nk(nk(nk(add('ОП-НК', 'ОП-06', 'ВИК/ПВК годны; ожидается результат УЗК.'), 'vik', 'годен'), 'pvk', 'годен', 14), 'uzk', undefined, 15)
completeNk(add('ОП-НК', 'ОП-07', 'Основной НК завершён: ВИК, ПВК и УЗК годны.'))
completeNk(add('ОП-НК', 'ОП-08', 'Однородное Т, РАД: одна группа материалов, один способ сварки и одно официальное клеймо.', { weldingMethod: 'РАД', technologyCardNumber: `${CARD}-РАД`, d1: 57, weldLength: '450.123456789123456789', weldingElectrodes: null, weldingElectrodesCertificateNumber: null, fillerWire: 'Св-08Г2С', shieldingGas: 'Аргон' }))
add('ОП-НК', 'ОП-09', 'Сварено, но L ещё не измерена: ожидается СП-03, запись можно дополнить.', { weldLength: null })
nk(add('ОП-НК', 'ОП-10', 'ВИК дал ремонт; диспетчер предложит создать ОП-10R1.'), 'vik', 'ремонт')

const repairStamp = { stamp1K: REPAIR_STAMP, stamp1KFact: REPAIR_STAMP, }
const root = nk(nk(add('ОП-РЕМОНТ', 'ОП-11', 'Исходная опора: УЗК дал ремонт. История продолжается в R1 и R2.', { d1: 57 }), 'vik', 'годен'), 'pvk', 'годен', 14)
nk(root, 'uzk', 'ремонт', 15)
const r1 = nk(nk(add('ОП-РЕМОНТ', 'ОП-11R1', 'Первый ремонт выполнен другим сварщиком; повторный УЗК снова дал ремонт.', { ...repairStamp, d1: 57, weldDate: date(19) }), 'vik', 'годен', 19), 'pvk', 'годен', 20)
nk(r1, 'uzk', 'ремонт', 21)
completeNk(add('ОП-РЕМОНТ', 'ОП-11R2', 'Второй ремонт годен. Вся цепочка — одна физическая опора, у каждого ремонта полная L.', { ...repairStamp, d1: 57, weldDate: date(23) }), false, 23)
nk(add('ОП-РЕМОНТ', 'ОП-12', 'ВИК дал ремонт; продолжение R1 создано, но ещё не сварено.'), 'vik', 'ремонт')
unwelded(add('ОП-РЕМОНТ', 'ОП-12R1', 'Ремонт R1 подготовлен к сварке, дата и клеймо ещё не заполнены.'))

add('ОП-ПСТО', 'ОП-13', 'ПСТО назначена; сначала предстоит выполнить НК до ТО.')
nk(add('ОП-ПСТО', 'ОП-14', 'Заявка ВИК до ТО создана; результат ожидается.'), 'vik', undefined, 13, true)
completeNk(add('ОП-ПСТО', 'ОП-15', 'Все методы НК до ТО годны; можно создать заявку ПСТО.'), true)
heat(add('ОП-ПСТО', 'ОП-16', 'Создана заявка ПСТО; термообработка ещё не выполнена.'), 'request')
heat(add('ОП-ПСТО', 'ОП-17', 'ПСТО проведена, диаграмма есть; предстоит заявка ТВМТ.'), 'done')
heat(add('ОП-ПСТО', 'ОП-18', 'ПСТО проведена, заявка ТВМТ создана; результат ожидается.'), 'tvmt-request')
heat(add('ОП-ПСТО', 'ОП-19', 'ПСТО/ТВМТ завершены; предстоит основной НК.'), 'good')
heat(add('ОП-ПСТО', 'ОП-20', 'ТВМТ негодна; требуется повторная ПСТО.'), 'bad')
const repeatRequest = heat(add('ОП-ПСТО', 'ОП-21', 'После негодной ТВМТ открыта заявка повторной ПСТО, цикл №2.'), 'bad')
repeatRequest.repeat = { sequence: 2, pstoRequest: 'ДЕМО-ОП-ПСТО-ОП-21-ПОВТОР-2', pstoRequestDate: date(21) }
const repeatGood = heat(add('ОП-ПСТО', 'ОП-22', 'Повторный цикл №2 завершён годной ТВМТ; можно выполнять основной НК.'), 'bad')
repeatGood.repeat = { sequence: 2, pstoRequest: 'ДЕМО-ОП-ПСТО-ОП-22-ПОВТОР-2', pstoRequestDate: date(21), pstoResult: 'проведено', pstoDate: date(22), heatTreatmentDiagram: 'ДЕМО-ОП-ДИАГРАММА-ОП-22-ПОВТОР-2', tvmtRequest: 'ДЕМО-ОП-ТВМТ-ОП-22-ПОВТОР-2', tvmtRequestDate: date(23), tvmtResult: 'годен', tvmtConclusionDate: date(24), tvmtConclusion: 'ДЕМО-ОП-ТВМТ-ОП-22-ПОВТОР-2-ЗАКЛ' }
completeNk(heat(add('ОП-ПСТО', 'ОП-23', 'Полностью завершены НК до ТО, ПСТО, ТВМТ и основной НК.'), 'good'), false, 21)

nk(add('ОП-ПРОГРАММА', 'ОП-24', '50%: основной УЗК не назначен, можно выбрать опору для нормы.', { hasUzk: null, hasPvk: null }), 'vik', 'годен')
nk(add('ОП-ПРОГРАММА', 'ОП-25', '50%: назначены УЗК и ПВК, заявок пока нет.'), 'vik', 'годен')
nk(add('ОП-ПРОГРАММА', 'ОП-26', '50%: УЗК явно дополнительный. Назначение не является выполненным фактом.', { hasUzk: 'дополнительный' }), 'vik', 'годен')
nk(add('ОП-ПРОГРАММА', 'ОП-27', 'Невыполненный УЗК официально отменён; ПВК действует независимо.', { hasUzk: 'отменен', uzkControlBasis: 'Демонстрационное решение об отмене будущей работы' }), 'vik', 'годен')
assert.equal(fixtures.length, 30)

const [{ requireDb, closeDatabase }, schema, persistence, validation, documents, preDocuments, cycles, dirty, chains] = await Promise.all([
  import('../src/db'), import('../src/db/schema'), import('../src/server/weld-persistence'), import('../src/server/weld-save-validation'),
  import('../src/server/system-document-index'), import('../src/server/pre-heat-treatment-system-documents'), import('../src/server/psto-cycle-state'),
  import('../src/server/dispatcher-task-index-dirty'), import('../src/server/line-program-chain-state'),
])
const db = requireDb()
class RollbackCheck extends Error {}
let summary: unknown
try {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PROJECT}))`)
    const existing = await tx.select({ id: schema.weldJoints.id, joint: schema.weldJoints.joint }).from(schema.weldJoints).where(eq(schema.weldJoints.projectTitle, PROJECT))
    const existingLines = await tx.select({ id: schema.linePrograms.id }).from(schema.linePrograms).where(eq(schema.linePrograms.projectTitle, PROJECT))
    if (existing.length || existingLines.length) { summary = { skipped: true, project: PROJECT, rows: existing }; return }
    const oldWelds = await tx.select().from(schema.weldJoints).orderBy(schema.weldJoints.id)
    const oldSettings = await tx.select().from(schema.appSettings).orderBy(schema.appSettings.key)
    const oldDocuments = await tx.select().from(schema.generatedDocuments).orderBy(schema.generatedDocuments.id)
    assert.equal((await tx.select().from(schema.welderStamps).where(inArray(schema.welderStamps.naksStamp, [STAMP, REPAIR_STAMP]))).length, 0, 'Demo stamp already exists; refusing overwrite')
    assert.equal((await tx.select().from(schema.technologyCards).where(inArray(schema.technologyCards.name, [`${CARD}-М01`, `${CARD}-М05`, `${CARD}-РАД`]))).length, 0, 'Demo card already exists; refusing overwrite')
    for (const [i, stamp] of [STAMP, REPAIR_STAMP].entries()) {
      const permits = ['РД', 'РАД'].map(weldType => ({ id: `demo-op-${stamp}-${weldType}`, weldType, materialGroups: 'М01, М05', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31', note: 'Учебный локальный допуск, не реальный документ' }))
      await tx.insert(schema.welderStamps).values({ naksStamp: stamp, internalStamp: `Д-ОП-${i + 1}`, welderName: i ? 'Демо — ремонт опор' : 'Демо — сварка опор',
        weldType: 'РД, РАД', materialGroups: 'М01, М05', diameterFrom: '20', diameterTo: '1200', thicknessFrom: '2', thicknessTo: '50', validFrom: '2026-01-01', validTo: '2027-12-31',
        naksPermits: JSON.stringify(permits), dlsPermits: JSON.stringify(permits.map(p => ({ ...p, id: `${p.id}-dls`, number: `ДЕМО-ДЛС-${stamp}-${p.weldType}` }))) })
    }
    const cards = await tx.insert(schema.technologyCards).values([
      { name: `${CARD}-М01`, weldingMethods: ['РД'], materialGroups: ['М01'] },
      { name: `${CARD}-М05`, weldingMethods: ['РД'], materialGroups: ['М05'] },
      { name: `${CARD}-РАД`, weldingMethods: ['РАД'], materialGroups: ['М01'] },
    ].map(p => ({ ...p, connectionType: 'Т1', diameterFrom: 20, diameterTo: 1200, thicknessFrom: 2, thicknessTo: 50, psto: 'any' as const, firstUsedAt: new Date() }))).returning()
    await tx.insert(schema.technologyCardNames).values(cards.map(card => ({ name: card.name, technologyCardId: card.id })))
    await tx.insert(schema.specialists).values([
      { name: 'Демо — дефектоскопист опор', kind: 'inspector', certificate: 'ДЕМО-ОП-НК-2026', methods: ['ВИК', 'ПВК', 'УЗК', 'ТВМТ'] },
      { name: 'Демо — термист опор', kind: 'thermist', certificate: 'ДЕМО-ОП-ТО-2026', methods: [] },
    ])
    const programs = await tx.insert(schema.linePrograms).values(plans.map(p => ({ projectTitle: PROJECT, subtitleCode: SUBTITLE, line: p.line,
      category: 'II', groupName: 'Б(а)', weldControlPercent: 100, pvkControlPercent: 100, supportUzkControlPercent: p.rate, supportPvkControlPercent: p.rate,
      pstoAssignment: p.heat ? 'assigned' as const : 'unassigned' as const }))).returning()
    const context = await validation.loadServerWeldValidationContext(tx, fixtures.map(f => f.row))
    assert(context.controlProcessSettings.preHeatTreatmentMode === 'allPsto', 'This demo requires existing pre-TO setting; no settings changed')
    for (const f of fixtures) {
      if (f.row.technologyCardNumber) assert(checkTechnologyCardApplicability(cards.find(c => c.name === f.row.technologyCardNumber)!, f.row, context.dataListSettings).applicable, `Invalid demo card: ${f.row.joint}`)
      f.row.preHeatTreatmentMode = context.controlProcessSettings.preHeatTreatmentMode
      f.row.preHeatTreatmentControls = f.pre.map((p, i) => ({ ...p, id: i + 1, weldJointId: f.row.id }))
      // Validate/create primary history before opening its later repeat cycle.
      f.row.pstoRepeatCycles = []
    }
    const primaryNkKeys = (['vik', 'pvk', 'uzk'] as const).flatMap(method =>
      (['Request', 'RequestDate', 'Result', 'Conclusion', 'ConclusionDate', 'DefectDescription'] as const).map(suffix => `${method}${suffix}` as keyof WeldRow))
    const initialRows = fixtures.map(({ row }) => row.tvmtRequest ? {
      ...row, tvmtRequest: null, tvmtRequestDate: null, tvmtResult: null, tvmtConclusion: null, tvmtConclusionDate: null,
      ...Object.fromEntries(primaryNkKeys.map(key => [key, null])),
    } : row)
    validation.validateServerWeldRecords({ records: initialRows, previousRows: new Map(), context, allowSystemJointNames: true })
    const saved: WeldRow[] = []
    for (const [index, f] of fixtures.entries()) {
      const line = programs.find(p => p.line === f.row.line)!
      const initial = initialRows[index]
      const [record] = await tx.insert(schema.weldJoints).values({ ...persistence.toDbInsert({ ...initial, lineProgramId: line.id }, true), finalStatus: calculateFinalStatus(initial) }).returning()
      const pre = f.pre.length ? await tx.insert(schema.preHeatTreatmentControls).values(f.pre.map(p => ({ ...p, weldJointId: record.id }))).returning() : []
      let row = { ...record, preHeatTreatmentMode: 'allPsto' as const, preHeatTreatmentControls: pre, pstoRepeatCycles: [] } as unknown as WeldRow
      const validateNext = (next: WeldRow) => validation.validateServerWeldRecords({ records: [next], previousRows: new Map([[row.id, row as unknown as WeldJoint]]), context, allowSystemJointNames: true })
      const writePrimary = async (action: 'tvmtRequest' | 'tvmtResult', patch: Partial<WeldRow>) => {
        const next = { ...row, ...patch }
        validateNext(next)
        const [updated] = await cycles.persistPstoCycleWorkflowWrites({ tx, action, sourceRows: [row], writes: [{ source: 'primary', row: next }] })
        row = { ...row, ...updated, preHeatTreatmentMode: 'allPsto' as const, preHeatTreatmentControls: pre }
      }
      if (f.row.tvmtRequest) {
        await writePrimary('tvmtRequest', { tvmtRequest: f.row.tvmtRequest, tvmtRequestDate: f.row.tvmtRequestDate, tvmtResult: 'ожидает НК' })
        if (f.row.tvmtResult) await writePrimary('tvmtResult', { tvmtResult: f.row.tvmtResult, tvmtConclusion: f.row.tvmtConclusion, tvmtConclusionDate: f.row.tvmtConclusionDate })
        if (f.row.vikRequest) {
          const patch = Object.fromEntries(primaryNkKeys.map(key => [key, f.row[key] ?? null]))
          const next = { ...row, ...patch }
          validateNext(next)
          const [updated] = await tx.update(schema.weldJoints).set({ ...patch, finalStatus: calculateFinalStatus(next) }).where(eq(schema.weldJoints.id, row.id)).returning()
          row = { ...row, ...updated } as WeldRow
        }
      }
      if (f.repeat) {
        const r = f.repeat, saveCheckSettings = context.saveCheckSettings
        const write = async (action: Parameters<typeof cycles.persistPstoCycleWorkflowWrites>[0]['action'], cycle: PstoRepeatCycleWrite) => {
          const [updated] = await cycles.persistPstoCycleWorkflowWrites({ tx, action, sourceRows: [row], writes: [{ source: 'repeat', cycle }] })
          row = { ...row, ...updated, preHeatTreatmentMode: 'allPsto' as const, preHeatTreatmentControls: pre }
        }
        await write('pstoRequest', buildRepeatPstoRequestCycle({ row, requestName: r.pstoRequest!, requestDate: r.pstoRequestDate!, saveCheckSettings }))
        if (r.pstoDate) await write('pstoResult', buildRepeatPstoResultCycle({ row, pstoDate: r.pstoDate, diagramName: r.heatTreatmentDiagram!, saveCheckSettings }))
        if (r.tvmtRequest) await write('tvmtRequest', buildRepeatTvmtRequestCycle({ row, requestName: r.tvmtRequest, requestDate: r.tvmtRequestDate!, saveCheckSettings }))
        if (r.tvmtResult) await write('tvmtResult', buildRepeatTvmtResultCycle({ row, controlDate: r.tvmtConclusionDate!, result: r.tvmtResult, conclusionName: r.tvmtConclusion!, saveCheckSettings }))
      }
      saved.push(row)
    }
    await documents.syncSystemDocumentsForWeldChangesInTransaction(tx, saved, new Map())
    await preDocuments.syncPreHeatTreatmentDocumentsInTransaction(tx, saved, saved.flatMap(r => r.preHeatTreatmentControls ?? []))
    for (const row of saved.filter(r => r.pstoRequest)) {
      const cycleRows = [{ virtual: buildPrimaryPstoSystemDocumentRow(row), relationId: row.id, sequence: 1 },
        ...(row.pstoRepeatCycles ?? []).map(c => ({ virtual: buildPstoRepeatSystemDocumentRow(row, c), relationId: c.id, sequence: c.sequence }))]
      for (const c of cycleRows) await documents.upsertSourcedSystemDocumentsInTransaction({ tx, documents: SYSTEM_DOCUMENT_TYPES.flatMap(type =>
        buildSystemDocumentSummaries([c.virtual], type).map(summary => ({ summary: { ...summary, sourceKind: 'pstoCycle' as const, cycleSequences: [c.sequence] },
          sourcePositions: [{ kind: 'pstoCycle' as const, weldJointId: row.id, relationId: c.relationId, sequence: c.sequence, ...(summary.methodCode ? { methodCode: summary.methodCode } : {}) }] }))) })
    }
    await chains.attachProgramChainStates(saved, tx)
    assert.equal(saved.find(r => r.joint === 'ОП-11R2')?.programChainState?.physicalRootId, saved.find(r => r.joint === 'ОП-11')?.id)
    assert.equal(getPstoTvmtWorkflowState(saved.find(r => r.joint === 'ОП-21')!), 'waiting-psto')
    assert.equal(getPstoTvmtWorkflowState(saved.find(r => r.joint === 'ОП-22')!), 'complete')
    const oldIds = new Set(oldWelds.map(r => r.id)), oldDocIds = new Set(oldDocuments.map(d => d.id))
    assert.deepEqual((await tx.select().from(schema.weldJoints).orderBy(schema.weldJoints.id)).filter(r => oldIds.has(r.id)), oldWelds, 'Existing welds changed')
    assert.deepEqual(await tx.select().from(schema.appSettings).orderBy(schema.appSettings.key), oldSettings, 'Settings changed')
    const allDocuments = await tx.select().from(schema.generatedDocuments).orderBy(schema.generatedDocuments.id)
    assert.deepEqual(allDocuments.filter(d => oldDocIds.has(d.id)), oldDocuments, 'Existing documents changed')
    await dirty.markDispatcherTaskIndexDirty(tx, { scopes: dirty.getDispatcherDirtyScopes(saved, new Map()) })
    summary = { project: PROJECT, subtitle: SUBTITLE, created: saved.length, preserved: oldWelds.length, lines: programs.map(p => p.line),
      documents: allDocuments.length - oldDocuments.length, rows: saved.map(r => ({ id: r.id, line: r.line, joint: r.joint, status: r.finalStatus, stage: getPstoTvmtWorkflowState(r), note: r.weldingJournalNote })) }
    if (!apply && !seedTest) throw new RollbackCheck()
  })
} catch (error) { if (!(error instanceof RollbackCheck)) throw error }
finally { await closeDatabase() }
console.log(JSON.stringify({ applied: apply || seedTest, summary }, null, 2))
