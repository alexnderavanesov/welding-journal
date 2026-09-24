import { describe, expect, it } from 'vitest'

import type { WeldRow } from '@/lib/dispatcher-types'
import { getPrimaryPstoStartBlockReason, requiresPreHeatTreatmentLnk, getRejectedPreHeatTreatmentControls } from '@/lib/lnk-control-stage'
import { buildPreHeatTreatmentRequestWrites, buildPreHeatTreatmentResultWrite, getPreHeatTreatmentRequestBlockReason } from '@/lib/pre-heat-treatment-control-updates'
import { buildRepeatedJointDraft } from '@/lib/repeated-joint-draft'
import { buildLnkChronologyCheckTasks, buildLnkResultCompletenessCheckTasks } from '@/lib/repeated-joint-check-tasks'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'

const fresh = { id: 6620, joint: 'F1', line: '330-P42/P59-06-000', pstoRequired: 'да', hasVik: 'да', preHeatTreatmentLnkExempt: true, pstoResult: 'ожидает заявку' } as WeldRow

describe('uniform pre-TO requirements', () => {
  it.each(['ожидает заявку', 'ожидает', null])('does not exempt an unstarted joint with PSTO result %s', (pstoResult) => {
    const row = { ...fresh, pstoResult }
    expect(requiresPreHeatTreatmentLnk(row)).toBe(true)
    expect(getPreHeatTreatmentRequestBlockReason(row, 'ВИК')).toBe('')
    expect(getPrimaryPstoStartBlockReason(row)).toContain('Сначала создайте заявки НК до ТО')
  })

  it('requires pre-TO for a started joint and allows factual backfill', () => {
    const row = { ...fresh, pstoRequest: 'ПСТО-270', pstoDate: '2026-07-10', pstoResult: 'проведено' }
    expect(requiresPreHeatTreatmentLnk(row)).toBe(true)
    expect(getPrimaryPstoStartBlockReason(row)).toContain('Сначала создайте заявки НК до ТО')
    expect(getPreHeatTreatmentRequestBlockReason(row, 'ВИК')).toBe('')
  })

  it('does not hide a rejected actual result behind historical exemption', () => {
    const row = { ...fresh, pstoRequest: 'ПСТО-270', preHeatTreatmentControls: [{ id: 1, weldJointId: fresh.id, method: 'ВИК', requestName: 'НК-1', result: 'вырез' }] }
    expect(getRejectedPreHeatTreatmentControls(row)).toHaveLength(1)
    expect(getPrimaryPstoStartBlockReason(row)).toContain('негодный результат')
  })

  it('removes the disabled stage from the active workflow without changing documents', () => {
    const row = { ...fresh, preHeatTreatmentLnkExempt: false, preHeatTreatmentLnkEnabled: false }
    expect(requiresPreHeatTreatmentLnk(row)).toBe(false)
    expect(getPrimaryPstoStartBlockReason(row)).toBe('')
    expect(getPreHeatTreatmentRequestBlockReason(row, 'ВИК')).toContain('выключен')
  })

  it.each([true, false])('off/on applies equally to every joint, obsolete flag=%s', (flag) => {
    const neighbour = { ...fresh, preHeatTreatmentLnkExempt: flag, preHeatTreatmentLnkEnabled: false }
    const started = { ...neighbour, pstoRequest: 'ПСТО, начатая без этапа' }
    for (const row of [neighbour, started, buildRepeatedJointDraft(started, 'F1R1')]) {
      expect(requiresPreHeatTreatmentLnk({ ...row, preHeatTreatmentLnkEnabled: false })).toBe(false)
      expect(requiresPreHeatTreatmentLnk({ ...row, preHeatTreatmentLnkEnabled: true })).toBe(true)
    }
  })

  it('requires no incomplete-document or date repairs for a disabled historical stage', () => {
    const row = { ...fresh, preHeatTreatmentLnkEnabled: false, weldDate: '2026-09-20',
      preHeatTreatmentControls: [{ id: 1, weldJointId: fresh.id, method: 'ВИК', requestName: 'Старая заявка', requestDate: '2026-09-01', result: 'годен' }],
    }
    expect(buildLnkResultCompletenessCheckTasks([row])).toEqual([])
    expect(buildLnkChronologyCheckTasks([row])).toEqual([])
    expect(row.preHeatTreatmentControls).toHaveLength(1)
    expect(buildLnkResultCompletenessCheckTasks([{ ...row, preHeatTreatmentLnkEnabled: true }])).toHaveLength(1)
  })

  it('allows historical request backfill but keeps chronology checks', () => {
    const row = { ...fresh, weldDate: '2026-07-10', pstoDate: '2026-07-12', pstoRequest: 'ПСТО-270' }
    const create = (requestDate: string) => buildPreHeatTreatmentRequestWrites({ row, methodCodes: ['ВИК'], requestName: 'Фактическая заявка', requestDate, saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS })
    expect(create('2026-07-11')).toHaveLength(1)
    expect(() => create('2026-07-09')).toThrow('раньше даты сварки')
    expect(() => create('2026-07-13')).toThrow('позже даты ПСТО')
  })

  it('allows factual historical results while retaining the request/PSTO date order', () => {
    const row = { ...fresh, weldDate: '2026-07-10', pstoDate: '2026-07-12', pstoRequest: 'ПСТО-270',
      preHeatTreatmentControls: [{ id: 1, weldJointId: fresh.id, method: 'ВИК', requestName: 'Заявка ВИК до ТО', requestDate: '2026-07-11' }],
    }
    const result = (controlDate: string) => buildPreHeatTreatmentResultWrite({ row, methodCode: 'ВИК', controlDate, result: 'годен', conclusionName: 'Фактическое заключение', saveCheckSettings: DEFAULT_SAVE_CHECK_SETTINGS })
    expect(result('2026-07-11')).toMatchObject({ id: 1, result: 'годен' })
    expect(() => result('2026-07-10')).toThrow('раньше даты заявки')
    expect(() => result('2026-07-13')).toThrow('позже даты ПСТО')
  })
})
