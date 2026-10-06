import { describe, expect, it } from 'vitest'
import { getWeldFormSaveBlockReason } from './weld-form-save-reasons'
import { DEFAULT_SAVE_CHECK_SETTINGS } from './save-check-settings'
import type { WeldInput } from './weld-fields'
import { assertUnofficialLnkGoodResultAllowed } from './unofficial-lnk-result-guard'
import { LNK_METHODS } from './lnk-report-config'
import { buildLnkResultCorrectionRow, buildLnkResultReplacementRows } from './lnk-result-correction-updates'
import type { RowWithId } from './lnk-report-mutation-types'

const checksOff = Object.fromEntries(Object.keys(DEFAULT_SAVE_CHECK_SETTINGS).map(key => [key, false])) as typeof DEFAULT_SAVE_CHECK_SETTINGS
const previous: WeldInput = { id: 1, joint: 'S1R1', officiality: 'неофициальный', hasVik: 'да', vikResult: 'годен', hasUzk: 'да', uzkResult: 'ремонт' }

describe('unofficial LNK result correction', () => {
  it.each(LNK_METHODS)('protects $code while preserving other good methods', method => {
    const row = { ...previous, [method.resultKey]: 'вырез' }
    expect(getWeldFormSaveBlockReason({ ...row, [method.resultKey]: 'годен' }, row, checksOff)).toContain('Сначала верните')
  })
  it('blocks single and bulk UI corrections before sending a request', () => {
    const record = previous as RowWithId
    expect(() => buildLnkResultCorrectionRow({ record, methodKey: 'uzkRequest', result: 'годен' })).toThrow('Сначала верните')
    expect(() => buildLnkResultReplacementRows({ updates: [{ record, methodKey: 'uzkRequest', result: 'годен' }] })).toThrow('Сначала верните')
  })
  it.each(['ВИК (дубль)', 'РК (дубль)', 'УЗК (дубль)', 'ПВК (дубль)', 'УЗК до ТО'])('applies the same factual guard to %s', method => {
    expect(() => assertUnofficialLnkGoodResultAllowed(previous, 'годен', 'вырез', method)).toThrow('Сначала верните')
    expect(() => assertUnofficialLnkGoodResultAllowed(previous, 'годен', null, method)).toThrow('Сначала верните')
    expect(() => assertUnofficialLnkGoodResultAllowed(previous, 'годен', 'годен', method)).not.toThrow()
  })
  it.each(['ремонт', 'вырез', null, 'ожидает НК'])('requires prior officiality restoration before %s → good, even with checks off', result => {
    expect(getWeldFormSaveBlockReason({ ...previous, uzkResult: 'годен' }, { ...previous, uzkResult: result }, checksOff))
      .toContain('Сначала верните стыку официальность')
  })
  it('does not accept a forged simultaneous restoration and good result', () => {
    expect(getWeldFormSaveBlockReason({ ...previous, officiality: null, uzkResult: 'годен' }, previous, checksOff))
      .toContain('Сначала верните стыку официальность')
  })
  it('preserves existing mixed history and allows metadata corrections', () => {
    const mixed = { ...previous, hasRk: 'да', rkResult: 'годен' }
    expect(getWeldFormSaveBlockReason({ ...mixed, rkConclusion: 'Исправленный номер' }, mixed, checksOff)).toBeNull()
    expect(getWeldFormSaveBlockReason({ ...previous, uzkResult: 'вырез' }, previous, checksOff)).toBeNull()
  })
  it('allows a good result after officiality was restored in a separate save', () => {
    const official = { ...previous, officiality: null }
    expect(getWeldFormSaveBlockReason({ ...official, uzkResult: 'годен' }, official, checksOff)).toBeNull()
    expect(getWeldFormSaveBlockReason(official, previous, checksOff)).toBeNull()
  })
})
