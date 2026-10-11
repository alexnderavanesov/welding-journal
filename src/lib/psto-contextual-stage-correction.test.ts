import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTROL_PROCESS_SETTINGS } from './control-process-settings'
import type { WeldRow } from './dispatcher-types'
import type { LnkControlStage, PreHeatTreatmentControlRecord } from './lnk-control-stage'
import { LNK_METHODS } from './lnk-report-config'
import { buildLnkResultCompletenessCheckTasks } from './repeated-joint-check-tasks'
import { getDispatcherTaskCode } from './dispatcher-settings'
import {
  buildPstoContextualStageCorrection as build,
  getPstoContextualStageCorrectionReason as reason,
} from './psto-contextual-stage-correction'
import { DEFAULT_SYSTEM_INDEX_SETTINGS } from './system-index-settings'

const settings = DEFAULT_CONTROL_PROCESS_SETTINGS
const indices = DEFAULT_SYSTEM_INDEX_SETTINGS
const directions = ['beforeHeatTreatment', 'primary'] as const

const primary: Partial<WeldRow> = {
  vikRequest: ' Заявка ВИК ', vikRequestDate: '2026-08-01', vikResult: 'годен',
  vikConclusionDate: '2026-08-02', vikConclusion: 'ВИК-1', vikDefectDescription: 'ВИК: ДНО',
  pvkRequest: 'ПВК-З', pvkRequestDate: '2026-08-01', pvkResult: 'годен',
  pvkConclusionDate: '02.08.2026', pvkConclusion: 'ПВК-1', pvkDefectDescription: 'ПВК: ДНО',
  rkRequest: 'РК-З', rkRequestDate: '2026-08-01', rkResult: 'годен',
  rkConclusionDate: '2026-08-03', rkConclusion: 'РК-1',
  lnkDefectDescription: '0-100: ДНО\n100-0: ДНО', rkExposureConfirmedDiameter: 219.1,
  uzkRequest: 'УЗК-З', uzkRequestDate: '2026-08-01', uzkResult: 'годен',
  uzkConclusionDate: '2026-08-03', uzkConclusion: 'УЗК-1', uzkDefectDescription: 'УЗК: ДНО',
}
const pre: PreHeatTreatmentControlRecord[] = [
  { id: 101, weldJointId: 7, method: 'ВИК', requestName: ' Заявка ВИК ', requestDate: '2026-08-01',
    result: 'годен', conclusionDate: '2026-08-02', conclusionName: 'ВИК-1', defectDescription: 'ВИК: ДНО', rkExposureConfirmedDiameter: null },
  { id: 102, weldJointId: 7, method: 'РК', requestName: 'РК-З', requestDate: '2026-08-01',
    result: 'годен', conclusionDate: '2026-08-03', conclusionName: 'РК-1',
    defectDescription: '0-100: ДНО\n100-0: ДНО', rkExposureConfirmedDiameter: 219.1 },
  { id: 103, weldJointId: 7, method: 'УЗК', requestName: 'УЗК-З', requestDate: '2026-08-01',
    result: 'годен', conclusionDate: '2026-08-03', conclusionName: 'УЗК-1', defectDescription: 'УЗК: ДНО', rkExposureConfirmedDiameter: null },
  { id: 104, weldJointId: 7, method: 'ПВК', requestName: 'ПВК-З', requestDate: '2026-08-01',
    result: 'годен', conclusionDate: '02.08.2026', conclusionName: 'ПВК-1', defectDescription: 'ПВК: ДНО', rkExposureConfirmedDiameter: null },
]

function candidate(target: LnkControlStage, overrides: Partial<WeldRow> = {}): WeldRow {
  return {
    id: 7, joint: 'F7', projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'Целевая линия',
    weldDate: '2026-08-01', d1: 219.1, connectionType: 'С17', officiality: 'действующий',
    hasVik: 'да', hasRk: 'да', hasUzk: 'да', hasPvk: 'да',
    preHeatTreatmentLnkEnabled: true, pstoRepeatCycles: [], duplicateControls: [],
    ...(target === 'beforeHeatTreatment'
      ? { ...primary, pstoRequired: 'да', preHeatTreatmentControls: [] }
      : { pstoRequired: null, preHeatTreatmentControls: pre.map(control => ({ ...control })) }),
    ...overrides,
  }
}

function withPackageChange(target: LnkControlStage, methodCode: string, field: string, value: string | null) {
  const row = candidate(target)
  const method = LNK_METHODS.find(method => method.code === methodCode)!
  const primaryKey = { requestName: method.requestKey, requestDate: method.requestDateKey,
    result: method.resultKey, conclusionDate: method.conclusionDateKey, conclusionName: method.conclusionKey }[field]
  if (!primaryKey) throw new Error(`Unknown fixture field: ${field}`)
  if (target === 'beforeHeatTreatment') row[primaryKey] = value
  else row.preHeatTreatmentControls = row.preHeatTreatmentControls!.map(control =>
    control.method === methodCode ? { ...control, [field]: value } : control)
  return row
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

describe('contextual PSTO stage correction', () => {
  it('moves all four complete packages verbatim to negative-ID relations without changing input', () => {
    const row = freeze(candidate('beforeHeatTreatment', {
      pstoNote: 'Примечание', lnkNote: 'Общее примечание', rkBoq: 'BoQ', rowVersion: 'v7',
      duplicateControls: [{ id: 51, weldJointId: 7, method: 'ВИК', result: 'годен',
        controlDate: '2026-08-04', conclusionDate: '2026-08-04', conclusion: 'Дубль-1' }],
    }))
    const next = build(row, 'beforeHeatTreatment', settings, indices)
    expect(next.preHeatTreatmentControls).toEqual(pre.map(control => ({ ...control, id: expect.any(Number) })))
    expect(next.preHeatTreatmentControls!.every(control => Number.isSafeInteger(control.id) && control.id < 0)).toBe(true)
    expect(new Set(next.preHeatTreatmentControls!.map(control => control.id)).size).toBe(4)
    expect(Object.keys(primary).every(key => next[key as keyof WeldRow] === null)).toBe(true)
    expect(next).toMatchObject({ pstoRequired: 'да', line: 'Целевая линия', rowVersion: 'v7',
      pstoNote: 'Примечание', lnkNote: 'Общее примечание', rkBoq: 'BoQ', preVikRequest: ' Заявка ВИК ' })
    expect(next.duplicateControls).toBe(row.duplicateControls)
    expect(row).toMatchObject(primary)
    expect(row.preHeatTreatmentControls).toEqual([])
    const other = build(candidate('beforeHeatTreatment', { id: 8 }), 'beforeHeatTreatment', settings, indices)
    expect(other.preHeatTreatmentControls!.some(control =>
      next.preHeatTreatmentControls!.some(first => first.id === control.id))).toBe(false)
  })

  it('promotes the complete package, removes stale virtual facts, and keeps cancellation metadata', () => {
    const row = freeze(candidate('primary', {
      pstoRequired: 'отменен', pstoCancellationDate: '2026-08-08', pstoControlBasis: 'ТР-1',
      preVikResult: 'вырез', finalStatus: 'не годен',
    }))
    const next = build(row, 'primary', settings, indices)
    expect(next).toMatchObject({ ...primary, preHeatTreatmentControls: [], finalStatus: 'годен',
      pstoRequired: 'отменен', pstoCancellationDate: '2026-08-08', pstoControlBasis: 'ТР-1' })
    expect(next.preVikResult).toBeUndefined()
    expect(next.preRkConclusion).toBeUndefined()
    expect(row.preHeatTreatmentControls).toEqual(pre)
    expect(row.preVikResult).toBe('вырез')
  })

  it.each(directions)('keeps request-only values and ignores derived waiting labels (%s)', target => {
    const row = candidate(target, {
      pstoResult: 'ожидает заявку ПСТО', tvmtResult: 'ожидает ТВМТ', pstoNote: 'Ожидание',
      pstoBoq: 'да', tvmtKs3: 'КС3',
    })
    if (target === 'beforeHeatTreatment') {
      for (const method of LNK_METHODS) {
        row[method.resultKey] = method.code === 'ВИК' ? null : 'ожидает НК'
        row[method.conclusionKey] = null
        row[method.conclusionDateKey] = null
      }
    } else {
      row.vikResult = 'ожидает заявку'
      row.preHeatTreatmentControls = pre.map(control => ({ ...control, result: 'ожидает НК',
        conclusionName: null, conclusionDate: null }))
    }
    const next = build(row, target, settings, indices)
    expect(next.pstoResult).toBe(row.pstoResult)
    expect(next.tvmtResult).toBe(row.tvmtResult)
    expect(target === 'primary' ? next.vikResult : next.preHeatTreatmentControls![0].result)
      .toBe(target === 'primary' ? 'ожидает НК' : null)
  })

  const dependencies: Array<[string, Partial<WeldRow>]> = [
    ['request', { pstoRequest: 'ПСТО-1' }], ['request date alone', { pstoRequestDate: '2026-08-02' }],
    ['execution date', { pstoDate: '2026-08-02' }], ['diagram', { heatTreatmentDiagram: 'Д-1' }],
    ['result', { pstoResult: 'проведено' }], ['cancelled execution', { pstoResult: 'проведено (отменен)' }],
    ['annotated execution', { pstoResult: 'проведено · назначение отменено' }],
    ['TVMT request', { tvmtRequest: 'Т-1' }], ['TVMT request date', { tvmtRequestDate: '2026-08-02' }],
    ['TVMT result', { tvmtResult: 'не годен' }], ['TVMT conclusion', { tvmtConclusion: 'ЗТ-1' }],
    ['TVMT conclusion date', { tvmtConclusionDate: '2026-08-03' }],
    ['repeat relation', { pstoRepeatCycles: [{ id: 81, weldJointId: 7, sequence: 2, pstoResult: 'ожидает' }] }],
  ]
  describe.each(directions)('%s safeguards', target => {
    it.each(dependencies)('blocks %s even with the permissive primary setting', (_label, fields) => {
      const row = freeze(candidate(target, fields))
      const allowedEarly = { ...settings, allowPrimaryLnkBeforePreviousStagesComplete: true }
      expect(() => build(row, target, allowedEarly, indices)).toThrow('сохранены заявка или история ПСТО/ТВМТ')
      expect(reason(row, target, allowedEarly, indices)).toContain('сохранены заявка или история ПСТО/ТВМТ')
    })

    it('uses the explicit process settings over a stale row flag', () => {
      expect(() => build(candidate(target), target, { ...settings, preHeatTreatmentLnkEnabled: false }, indices))
        .toThrow('выключен')
      expect(reason(candidate(target, { preHeatTreatmentLnkEnabled: false }), target, settings, indices)).toBeNull()
    })

    it('requires officiality before introducing good results in another stage', () => {
      expect(() => build(candidate(target, { officiality: 'неофициальный' }), target, settings, indices))
        .toThrow('Сначала верните стыку официальность')
    })

    it('retains the last rejection of an unofficial weld instead of clearing it', () => {
      const row = candidate(target, { officiality: 'неофициальный', hasRk: null, hasUzk: null, hasPvk: null })
      if (target === 'beforeHeatTreatment') {
        for (const method of LNK_METHODS.slice(1)) {
          for (const key of [method.requestKey, method.requestDateKey, method.resultKey,
            method.conclusionKey, method.conclusionDateKey, method.defectDescriptionKey]) row[key] = null
        }
        row.rkExposureConfirmedDiameter = null
        row.vikResult = 'ремонт'
      } else row.preHeatTreatmentControls = [{ ...pre[0], result: 'ремонт' }]
      const next = build(freeze(row), target, settings, indices)
      expect(target === 'primary' ? next.vikResult : next.preHeatTreatmentControls![0].result).toBe('ремонт')
      expect(next.finalStatus).toBe('не годен')
    })

    it.each([
      ['request before weld', 'ВИК', 'requestDate', '2026-07-31', 'раньше даты сварки'],
      ['conclusion before request', 'ВИК', 'conclusionDate', '2026-07-31', 'раньше даты'],
      ['invalid request', 'ВИК', 'requestDate', '2026-02-31', 'формате'],
      ['invalid conclusion', 'РК', 'conclusionDate', '2026-02-31', 'формате'],
      ['date below minimum', 'ВИК', 'requestDate', '2023-12-31', '01.01.2024'],
      ['missing request name', 'ВИК', 'requestName', null, 'нет наименования заявки'],
      ['missing request date', 'ВИК', 'requestDate', null, 'нет даты заявки'],
      ['VIK after other methods', 'ВИК', 'conclusionDate', '2026-08-05', 'раньше даты ВИК'],
      ['missing good VIK', 'ВИК', 'result', 'ожидает НК', 'ВИК'],
      ['missing good PVK', 'ПВК', 'result', 'ожидает НК', 'требуется годный ПВК'],
      ['PVK after RK', 'ПВК', 'conclusionDate', '2026-08-04', 'позже РК'],
    ])('rejects historical %s without grandfathering it', (_label, method, field, value, message) => {
      const row = freeze(withPackageChange(target, method!, field!, value))
      expect(() => build(row, target, settings, indices)).toThrow(message!)
    })

    it('validates the weld date itself', () => {
      expect(() => build(candidate(target, { weldDate: '2026-02-31' }), target, settings, indices))
        .toThrow('Дата сварки')
    })

    it.each([
      ['conclusionDate', null, 'дату заключения'],
      ['conclusionDate', '-', 'дату заключения'],
      ['requestName', '-', 'наименования заявки'],
      ['requestDate', '-', 'даты заявки'],
    ])('requires complete documents for saved final results: %s=%s', (field, value, message) => {
      const row = freeze(withPackageChange(target, 'ВИК', field!, value))
      expect(() => build(row, target, settings, indices)).toThrow(message!)
      expect(reason(row, target, settings, indices)).toContain(message!)
    })

    it.each([null, '', '  '])('preserves optional conclusion names verbatim across the whole package: %s', name => {
      const row = candidate(target)
      if (target === 'beforeHeatTreatment') {
        for (const method of LNK_METHODS) row[method.conclusionKey] = name
      } else row.preHeatTreatmentControls = pre.map(control => ({ ...control, conclusionName: name }))
      freeze(row)
      expect(reason(row, target, settings, indices)).toBeNull()
      const next = build(row, target, settings, indices)
      const completionTasks = buildLnkResultCompletenessCheckTasks([next])
      expect(completionTasks).toHaveLength(1)
      expect(getDispatcherTaskCode(completionTasks[0]!)).toBe('СП-11')
      for (const method of LNK_METHODS) {
        expect(completionTasks[0]!.details).toContain(`${method.code}${target === 'beforeHeatTreatment' ? ' до ТО' : ''}: не заполнено заключение`)
      }
      if (target === 'primary') {
        expect(next).toMatchObject({ ...primary, ...Object.fromEntries(LNK_METHODS.map(method => [method.conclusionKey, name])) })
        expect(next.preHeatTreatmentControls).toEqual([])
      } else {
        expect(next.preHeatTreatmentControls).toEqual(pre.map(control => ({ ...control, id: expect.any(Number), conclusionName: name })))
        for (const key of Object.keys(primary)) expect(next[key as keyof WeldRow]).toBeNull()
      }
    })

    it.each([
      ['requestDate', '2026-07-31', 'раньше даты сварки'],
      ['conclusionDate', '2026-07-31', 'раньше даты'],
      ['conclusionDate', '2026-02-31', 'формате'],
      ['conclusionDate', null, 'дату заключения'],
    ])('still checks chronology with an optional empty name: %s=%s', (field, value, message) => {
      const row = withPackageChange(target, 'ВИК', field!, value)
      if (target === 'beforeHeatTreatment') row.vikConclusion = null
      else row.preHeatTreatmentControls![0].conclusionName = null
      expect(() => build(freeze(row), target, settings, indices)).toThrow(message!)
    })

    it.each(['годен (отменен)', 'годен · назначение отменено'])('retains SP-11 for historical unnamed results: %s', result => {
      const row = withPackageChange(target, 'ВИК', 'conclusionName', null)
      // A single historical method: do not ask cancelled VIK to authorize new
      // downstream methods. That prerequisite is intentionally not relaxed.
      row.hasRk = null; row.hasUzk = null; row.hasPvk = null
      if (target === 'beforeHeatTreatment') {
        row.vikResult = result
        for (const method of LNK_METHODS.filter(method => method.code !== 'ВИК')) {
          for (const key of [method.requestKey, method.requestDateKey, method.resultKey,
            method.conclusionKey, method.conclusionDateKey, method.defectDescriptionKey]) row[key] = null
        }
        row.rkExposureConfirmedDiameter = null
      } else row.preHeatTreatmentControls = [{ ...row.preHeatTreatmentControls![0], result }]
      const beforeTasks = buildLnkResultCompletenessCheckTasks([row])
      expect(beforeTasks).toHaveLength(1)
      const next = build(freeze(row), target, settings, indices)
      const afterTasks = buildLnkResultCompletenessCheckTasks([next])
      expect(afterTasks).toHaveLength(1)
      expect(getDispatcherTaskCode(afterTasks[0]!)).toBe('СП-11')
      expect(target === 'primary' ? next.vikResult : next.preHeatTreatmentControls![0].result).toBe(result)
    })

    it('does not treat an unnamed result as permission to bypass a PSTO request dependency', () => {
      const row = withPackageChange(target, 'ВИК', 'conclusionName', null)
      row.pstoRequest = 'ПСТО-1'
      row.pstoRequestDate = '2026-08-05'
      expect(() => build(freeze(row), target, settings, indices)).toThrow('сохранены заявка или история ПСТО/ТВМТ')
    })

    it('rejects an orphan conclusion even when no final result remains', () => {
      const row = withPackageChange(target, 'ВИК', 'requestName', null)
      if (target === 'beforeHeatTreatment') { row.vikRequestDate = null; row.vikResult = null }
      else Object.assign(row.preHeatTreatmentControls![0], { requestDate: null, result: null })
      expect(() => build(freeze(row), target, settings, indices)).toThrow('нет наименования заявки')
    })

    it('blocks downstream results after a rejected peer and multiple rejections', () => {
      const row = withPackageChange(target, 'РК', 'result', 'ремонт')
      if (target === 'beforeHeatTreatment') row.uzkConclusionDate = '2026-08-04'
      else row.preHeatTreatmentControls!.find(control => control.method === 'УЗК')!.conclusionDate = '2026-08-04'
      expect(() => build(row, target, settings, indices)).toThrow('после негодного РК')
      if (target === 'beforeHeatTreatment') { row.uzkResult = 'вырез'; row.uzkConclusionDate = '2026-08-03' }
      else Object.assign(row.preHeatTreatmentControls!.find(control => control.method === 'УЗК')!,
        { result: 'вырез', conclusionDate: '2026-08-03' })
      expect(() => build(row, target, settings, indices)).toThrow('только один негодный результат')
    })

    it('enforces diameter and the supplied custom repair indices', () => {
      const row = withPackageChange(target, 'РК', 'result', 'ремонт')
      expect(() => build({ ...row, d1: 57 }, target, settings, indices)).toThrow('меньше 89')
      expect(() => build({ ...row, joint: 'F7Q1Q1' }, target, settings, { ...indices, repair: 'Q' }))
        .toThrow('Третий ремонт')
    })

    it('applies the PVK-good-only setting to the destination stage', () => {
      const row = withPackageChange(target, 'ПВК', 'result', 'ремонт')
      expect(() => build(row, target, { ...settings, pvkGoodOnly: true }, indices)).toThrow('ПВК — только годен')
    })
  })

  it('checks pre-TO availability using the already-applied target assignment', () => {
    expect(() => build(candidate('beforeHeatTreatment', { pstoRequired: null }), 'beforeHeatTreatment', settings, indices))
      .toThrow('не предусмотрен')
  })

  it('requires the entire target stage to be empty, including unrelated methods', () => {
    const onlyVik = candidate('primary', { preHeatTreatmentControls: [pre[0]], uzkRequest: 'Другой комплект' })
    expect(() => build(onlyVik, 'primary', settings, indices)).toThrow('основной этап НК уже заполнен')
    expect(() => build(candidate('beforeHeatTreatment', { preHeatTreatmentControls: [{ id: 8, weldJointId: 7, method: 'ПВК' }] }),
      'beforeHeatTreatment', settings, indices)).toThrow('НК до ТО уже заполнен')
  })

  it.each([{ lnkDefectDescription: 'Сохранённая схема' }, { rkExposureConfirmedDiameter: 219.1 },
    { vikResult: 'годен (отменен)' }, { pvkConclusionDate: '2026-08-02' }])('protects partial target data %j', fields => {
    expect(() => build(candidate('primary', fields), 'primary', settings, indices)).toThrow('основной этап НК уже заполнен')
  })

  it.each(['ВИК', 'РК', 'УЗК', 'ПВК'])('checks every transferred %s good result on unofficial welds', methodCode => {
    const method = LNK_METHODS.find(method => method.code === methodCode)!
    const row = candidate('primary', { officiality: 'неофициальный', preHeatTreatmentControls: [pre.find(control => control.method === methodCode)!] })
    expect(() => build(row, 'primary', settings, indices)).toThrow('официальность')
    const main = candidate('beforeHeatTreatment', { officiality: 'неофициальный' })
    for (const entry of LNK_METHODS) main[entry.resultKey] = entry === method ? 'годен' : null
    expect(() => build(main, 'beforeHeatTreatment', settings, indices)).toThrow('официальность')
  })

  it('does not detach completed main PVK from layered control', () => {
    expect(() => build(candidate('beforeHeatTreatment', { connectionType: 'У17', layeredControlAssigned: true }),
      'beforeHeatTreatment', settings, indices)).toThrow('Сначала уберите послойный контроль')
  })

  it('retains layered rejection protection on the transformed record', () => {
    const row = withPackageChange('primary', 'РК', 'result', 'ремонт')
    row.layeredControlAssigned = true
    row.connectionType = 'У17'
    expect(() => build(row, 'primary', settings, indices)).toThrow('При послойном контроле нельзя сохранить')
  })

  it.each([
    [{ ...pre[0], method: 'НЕИЗВЕСТНЫЙ' }],
    [{ ...pre[0], weldJointId: 8 }],
    [pre[0], { ...pre[0], id: 999 }],
  ])('does not silently discard an invalid pre-TO relation set', (...controls) => {
    expect(() => build(candidate('primary', { preHeatTreatmentControls: controls }), 'primary', settings, indices))
      .toThrow('Состав НК до ТО некорректен')
  })

  it('rejects an empty source consisting only of waiting labels', () => {
    expect(() => build({ id: 7, pstoRequired: 'да', vikResult: 'ожидает заявку' }, 'beforeHeatTreatment', settings, indices))
      .toThrow('Нет основного комплекта')
    expect(() => build(candidate('primary', { preHeatTreatmentControls: [{ id: 101, weldJointId: 7, method: 'ВИК', result: 'ожидает НК' }] }),
      'primary', settings, indices)).toThrow('Нет комплекта НК до ТО')
  })

  it('returns the same validation reason and leaves a failed input intact', () => {
    const row = freeze(candidate('primary', { vikRequest: 'Уже занято' }))
    const message = reason(row, 'primary', settings, indices)
    expect(message).toBeTruthy()
    expect(() => build(row, 'primary', settings, indices)).toThrow(message!)
    expect(reason(candidate('primary'), 'primary', settings, indices)).toBeNull()
    expect(row.preHeatTreatmentControls).toEqual(pre)
  })
})
