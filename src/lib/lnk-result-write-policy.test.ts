import { beforeEach, describe, expect, it } from 'vitest'
import { buildLnkResultRows } from '@/lib/lnk-result-create-updates'
import { buildLnkResultCorrectionRow, buildLnkResultReplacementRows } from '@/lib/lnk-result-correction-updates'
import type { WeldRow } from '@/lib/dispatcher-types'
import { DEFAULT_SAVE_CHECK_SETTINGS } from '@/lib/save-check-settings'
import type { WeldFieldKey } from '@/lib/weld-fields'

const permissiveChecks = Object.fromEntries(Object.keys(DEFAULT_SAVE_CHECK_SETTINGS).map((key) => [key, false])) as typeof DEFAULT_SAVE_CHECK_SETTINGS

const entryPoints = {
  create: (record: WeldRow, methodKey: WeldFieldKey, result: string) => buildLnkResultRows({
    records: [record], methodKey, resultById: { [record.id]: result }, controlDate: '2026-08-20', conclusionName: 'ЗНК-1',
    saveCheckSettings: permissiveChecks, rkExposureTable: null,
  })[0],
  correct: (record: WeldRow, methodKey: WeldFieldKey, result: string) => buildLnkResultCorrectionRow({
    record, methodKey, result, rkExposureTable: null,
  }),
  replace: (record: WeldRow, methodKey: WeldFieldKey, result: string) => buildLnkResultReplacementRows({
    updates: [{ record, methodKey, result }], rkExposureTable: null,
  })[0],
}

describe.each(Object.entries(entryPoints))('LNK %s result policy', (_name, write) => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('welding-save-check-settings', JSON.stringify({ ...permissiveChecks, lnkResultRepairRules: false }))
  })

  it.each(['vikRequest', 'pvkRequest'] as const)('permits a small-diameter repair but never cutout for %s', (methodKey) => {
    const row = { id: 1, joint: 'F1', d1: 159, d2: 57, vikResult: 'годен' } as WeldRow
    expect(() => write(row, methodKey, 'ремонт')).not.toThrow()
    expect(() => write(row, methodKey, 'вырез')).toThrow(/СП-07.*вырез/)
    expect(() => write({ ...row, joint: 'F1R2' }, methodKey, 'ремонт')).toThrow(/СП-07.*два ремонта/)
    expect(() => write({ ...row, joint: 'F1R2' }, methodKey, 'годен')).not.toThrow()
  })

  it.each(['rkRequest', 'uzkRequest'] as const)('enforces Dmin and official repair limit for %s', (methodKey) => {
    const row = { id: 1, joint: 'F1', d1: 159, d2: 57, vikResult: 'годен' } as WeldRow
    expect(() => write(row, methodKey, 'ремонт')).toThrow(/СП-07.*меньше 89 мм/)
    expect(() => write(row, methodKey, 'вырез')).not.toThrow()
    expect(() => write({ ...row, d2: 89 }, methodKey, 'ремонт')).not.toThrow()
    expect(() => write({ ...row, joint: 'F1R2', d2: 89 }, methodKey, 'ремонт')).toThrow(/СП-07.*два ремонта/)
    expect(() => write({ ...row, joint: 'F1R2' }, methodKey, 'вырез')).not.toThrow()
  })

  it('keeps layered control and pvkGoodOnly as additional restrictions', () => {
    const row = { id: 1, joint: 'F1', d1: 89, layeredControlAssigned: true } as WeldRow
    expect(() => write(row, 'rkRequest', 'вырез')).toThrow(/послойном контроле/)
    window.localStorage.setItem('welding-control-process-settings', JSON.stringify({ pvkGoodOnly: true }))
    expect(() => write({ ...row, layeredControlAssigned: false }, 'pvkRequest', 'ремонт')).toThrow(/ПВК — только годен/)
  })
})
