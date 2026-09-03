import { describe, expect, it } from 'vitest'

import {
  getPreHeatTreatmentLnkExemptionsForNewRows,
  getPreHeatTreatmentExemptionIdsToRetain,
  isControlProcessPstoStarted,
} from '@/server/control-process-settings'

function row(id: number, line: string, values: Record<string, unknown> = {}) {
  return {
    id,
    projectTitle: 'Проект',
    subtitleCode: 'Шифр',
    line,
    pstoRequest: null,
    pstoRequestDate: null,
    pstoDate: null,
    heatTreatmentDiagram: null,
    pstoResult: null,
    pstoNote: null,
    tvmtRequest: null,
    tvmtRequestDate: null,
    tvmtResult: null,
    tvmtConclusionDate: null,
    tvmtConclusion: null,
    ...values,
  }
}

describe('control process settings transitions', () => {
  it('treats a PSTO request as the start of the process', () => {
    expect(isControlProcessPstoStarted(row(1, 'Линия 1'))).toBe(false)
    expect(isControlProcessPstoStarted(row(1, 'Линия 1', { pstoRequest: 'Заявка ПСТО' }))).toBe(true)
    expect(isControlProcessPstoStarted(row(1, 'Линия 1', { tvmtResult: 'годен' }))).toBe(true)
  })

  it('retains exemptions for the whole already-started PSTO line', () => {
    const rows = [
      row(1, 'Линия 1'),
      row(2, 'Линия 1', { pstoRequestDate: '2026-09-02' }),
      row(3, 'Линия 2'),
    ]

    expect(getPreHeatTreatmentExemptionIdsToRetain(rows)).toEqual([1, 2])
  })

  it('also treats a repeat cycle as started PSTO history', () => {
    const rows = [row(1, 'Линия 1'), row(2, 'Линия 1'), row(3, 'Линия 2')]

    expect(getPreHeatTreatmentExemptionIdsToRetain(rows, new Set([1]))).toEqual([1, 2])
  })

  it('marks every newly created weld exempt while pre-TO control is disabled', async () => {
    expect(await getPreHeatTreatmentLnkExemptionsForNewRows(settingTransaction({
      layeredControlEnabled: true,
      preHeatTreatmentLnkEnabled: false,
    }), [row(1, 'Линия 1'), row(2, 'Линия 2')])).toEqual([true, true])
  })

  it('inherits a retained exemption only inside the same non-empty PSTO line', async () => {
    const tx = settingTransaction({
      layeredControlEnabled: true,
      preHeatTreatmentLnkEnabled: true,
    }, [], [row(10, 'Линия 1')])

    expect(await getPreHeatTreatmentLnkExemptionsForNewRows(tx, [
      row(1, 'Линия 1'),
      row(2, 'Линия 2'),
      row(3, ''),
    ])).toEqual([true, false, false])
  })

  it('does not inherit an exemption when no retained PSTO line exists', async () => {
    expect(await getPreHeatTreatmentLnkExemptionsForNewRows(
      settingTransaction(undefined, [], []),
      [row(1, 'Линия 1')],
    )).toEqual([false])
  })

  it('locks the process setting before deciding the state of a new weld', async () => {
    const calls: string[] = []

    await getPreHeatTreatmentLnkExemptionsForNewRows(settingTransaction({
      preHeatTreatmentLnkEnabled: false,
    }, calls), [row(1, 'Линия 1')])

    expect(calls).toEqual(['lock', 'read'])
  })
})

function settingTransaction(
  value?: unknown,
  calls: string[] = [],
  exemptLines: Array<ReturnType<typeof row>> = [],
) {
  const settingResult = value === undefined ? [] : [{ value: JSON.stringify(value) }]
  let readIndex = 0
  return {
    execute: async () => {
      calls.push('lock')
    },
    select: () => {
      calls.push('read')
      const currentRead = readIndex++
      return {
        from: () => ({
          where: () => currentRead === 0
            ? { limit: async () => settingResult }
            : { groupBy: async () => exemptLines },
        }),
      }
    },
  } as unknown as Parameters<typeof getPreHeatTreatmentLnkExemptionsForNewRows>[0]
}
