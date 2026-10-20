import { describe, expect, it } from 'vitest'
import { buildRepeatedJointTasks } from './repeated-joint-tasks'
import { buildLnkChronologyCheckTasks, buildPstoChronologyCheckTasks } from './repeated-joint-check-tasks'
import { getDispatcherTaskCode, normalizeDispatcherSettings } from './dispatcher-settings'
import { getSystemRule } from './system-rule-catalog'
import { getDispatcherSettingIdsForSaveCheck } from './save-check-dispatcher-links'
import { normalizeSaveCheckSettings, formatSaveCheckBlockReason } from './save-check-settings'
import type { WeldRow } from './dispatcher-types'

const base: WeldRow = { id: 1, joint: 'F1', line: 'L1', weldDate: '2026-08-01', preHeatTreatmentLnkEnabled: true }

describe('retired document-completeness diagnostics (former SP-11)', () => {
  it.each([
    ['primary NK result', { hasVik: 'да', vikResult: 'годен', vikConclusion: '', vikConclusionDate: '' }],
    ['primary NK request', { hasVik: 'да', vikRequest: 'ВИК-1', vikRequestDate: '' }],
    ['pre-TO NK result', { preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', result: 'годен (отменен)' }] }],
    ['pre-TO NK request', { preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', requestDate: '2026-08-02' }] }],
    ['PSTO result', { pstoRequired: 'да', pstoResult: 'проведено', pstoDate: '', heatTreatmentDiagram: '' }],
    ['PSTO request', { pstoRequired: 'да', pstoRequest: 'ПСТО-1', pstoRequestDate: '' }],
    ['TVMT result', { pstoRequired: 'да', tvmtResult: 'годен', tvmtConclusion: '', tvmtConclusionDate: '' }],
    ['TVMT request', { pstoRequired: 'да', tvmtRequestDate: '2026-08-03' }],
    ['repeat cycle', { pstoRequired: 'отменен', pstoRepeatCycles: [{ id: 1, weldJointId: 1, sequence: 2,
      pstoResult: 'проведено', tvmtResult: 'не годен', pstoDate: '', heatTreatmentDiagram: '', tvmtConclusion: '', tvmtConclusionDate: '' }] }],
  ] satisfies Array<[string, Partial<WeldRow>]>)('does not diagnose missing requisites in %s or rewrite history', (_label, fields) => {
    const row = { ...base, ...fields }
    const before = structuredClone(row)
    const tasks = buildRepeatedJointTasks([row])
    expect(tasks.filter(task => task.kind === 'check').map(task => task.reason))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/^дозаполнить результат (ЛНК|ПСТО|ТВМТ)/)]))
    expect(row).toEqual(before)
  })

  it('removes only diagnostic settings and keeps mandatory save requirements', () => {
    expect(getSystemRule('СП-11')).toMatchObject({ title: 'Сохранность истории контроля' })
    const settings = normalizeDispatcherSettings({ 'check-lnk-result-completeness': true, 'check-psto-result-completeness': true })
    expect(settings).not.toHaveProperty('check-lnk-result-completeness')
    expect(settings).not.toHaveProperty('check-psto-result-completeness')
    const required = ['lnkResultControlDateRequired', 'lnkResultConclusionRequired', 'pstoResultDateRequired', 'pstoResultDiagramRequired'] as const
    const saveSettings = normalizeSaveCheckSettings(Object.fromEntries(required.map(key => [key, false])))
    for (const key of required) {
      expect(saveSettings[key]).toBe(true)
      expect(getDispatcherSettingIdsForSaveCheck(key)).toEqual([])
      expect(formatSaveCheckBlockReason(key, 'Заполните реквизиты.')).toBe('Заполните реквизиты.')
    }
  })

  it('does not transfer missing request requisites into chronology rules, including repeat cycles', () => {
    const row: WeldRow = {
      ...base,
      hasVik: 'да',
      vikRequest: 'ВИК-1', vikRequestDate: '',
      vikResult: 'годен', vikConclusion: 'ВИК-1', vikConclusionDate: '2026-08-02',
      preHeatTreatmentControls: [{ id: 1, weldJointId: 1, method: 'ВИК', requestName: '', requestDate: '2026-08-02' }],
      pstoRequest: 'ПСТО-1', pstoRequestDate: '',
      pstoResult: 'проведено', pstoDate: '2026-08-03', heatTreatmentDiagram: 'Д-1',
      tvmtRequest: '', tvmtRequestDate: '2026-08-04',
      tvmtResult: 'не годен', tvmtConclusionDate: '2026-08-05', tvmtConclusion: 'ТВМТ-1',
      pstoRepeatCycles: [{ id: 2, weldJointId: 1, sequence: 2, pstoRequest: 'ПСТО-2', pstoRequestDate: '',
        pstoResult: 'проведено', pstoDate: '2026-08-06', heatTreatmentDiagram: 'Д-2',
        tvmtRequest: 'ТВМТ-2', tvmtRequestDate: '', tvmtResult: 'годен', tvmtConclusionDate: '2026-08-07', tvmtConclusion: 'ТВМТ-2' }],
    }
    // Test the two independent calendars: the primary NK is not post-TO work.
    expect(buildLnkChronologyCheckTasks([{ ...row, pstoRequired: 'нет', pstoDate: '', pstoResult: '', pstoRepeatCycles: [] }])).toEqual([])
    expect(buildPstoChronologyCheckTasks([row])).toEqual([])
  })

  it('keeps actual date contradictions visible even alongside incomplete requisites', () => {
    const lnk = buildLnkChronologyCheckTasks([{
      ...base, hasVik: 'да', vikRequest: '', vikRequestDate: '2026-08-03',
      vikResult: 'годен', vikConclusion: '', vikConclusionDate: '2026-08-02',
    }])
    const psto = buildPstoChronologyCheckTasks([{
      ...base, pstoRequest: '', pstoRequestDate: '2026-08-03',
      pstoResult: 'проведено', pstoDate: '2026-08-02', heatTreatmentDiagram: '',
    }])
    for (const tasks of [lnk, psto]) {
      expect(tasks).toHaveLength(1)
      expect(getDispatcherTaskCode(tasks[0])).toBe('СП-04')
      expect(tasks[0].details).toMatch(/раньше даты заявки/)
      expect(tasks[0].details).not.toMatch(/нет наименования|нет даты заявки/)
    }
  })
})
