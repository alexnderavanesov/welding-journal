import type { DispatcherSettingId } from '@/lib/dispatcher-settings'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

export type DispatcherRuleFixture = {
  settingId: DispatcherSettingId
  rows: WeldRow[]
  expectedRowIds: number[]
  welderStamps: WelderStampRecord[]
}

/** Stored facts, not hand-built tasks: both the unit matrix and PostgreSQL
 * acceptance test feed these into the production rule generator. */
export function createDispatcherRuleFixtures(): DispatcherRuleFixture[] {
  const cases: Array<[DispatcherSettingId, Partial<WeldRow>[], number[]?]> = [
    ['percentage-new-welder', [{ stamp1K: 'A1' }, { stamp1K: 'A2', weldDate: '2026-07-02' }]],
    ['percentage-excess', [{ hasRk: 'да' }, { hasRk: 'да' }]],
    ['percentage-rejected-primary', [{ rkResult: 'вырез' }, {}]],
    ['percentage-missing', [{}, {}]],
    ['percentage-full-control', rejectedPercentageRows()],
    ['percentage-suspend-welder', rejectedPercentageRows()],
    ['repeated-create', [{ rkResult: 'ремонт' }]],
    ['repeated-create-official-from-unofficial', [{ officiality: 'неофициальный', rkResult: 'вырез' }]],
    ['repeated-coil', [
      { joint: 'S1', rkResult: 'вырез' },
      { joint: 'S1W1', rkResult: 'вырез' },
      { joint: 'S1W2', rkResult: 'вырез' },
      { joint: 'S1W3', rkResult: 'вырез' },
    ], [4]],
    ['repeated-delete', [{ joint: 'S1' }, { joint: 'S1R1', weldDate: null, stamp1K: null, stamp1KFact: null }], [2]],
    ['repeated-rename', [
      { joint: 'S1', rkResult: 'ремонт' },
      { joint: 'S1R1', officiality: 'неофициальный', rkResult: 'вырез' },
      { joint: 'S1R1W1', finalStatus: 'годен' },
    ], [3]],
    ['repeated-obsolete-check', [{ joint: 'S1' }, { joint: 'S1R1' }], [2]],
    ['chain-consistency', [{ joint: 'S1W1' }]],
    ['chain-duplicate', [{ joint: 'S1' }, { joint: 'S1' }]],
    ['chain-date-order', [
      { joint: 'S1', weldDate: '2026-07-03', rkResult: 'ремонт' },
      { joint: 'S1R1', weldDate: '2026-07-02' },
    ], [2]],
    ['check-repair-diameter', [{ d1: 57, d2: 57, rkResult: 'ремонт' }]],
    ['check-welder-stamp', [{ stamp1K: 'UNKNOWN' }]],
    ['check-incomplete-stamps', [{ stamp1KFact: null }]],
    ['check-lnk-request-date-order', [{ vikRequest: 'ВИК-1', vikRequestDate: '2026-06-30' }]],
    ['check-lnk-vik-date-order', [{
      vikResult: 'годен', vikConclusionDate: '2026-07-03',
      rkResult: 'годен', rkConclusionDate: '2026-07-02',
    }]],
    ['check-lnk-vik-required', [{ rkResult: 'годен', rkConclusionDate: '2026-07-02' }]],
    ['check-psto-request-date-order', [{ pstoRequired: 'да', pstoRequest: 'ПСТО-1', pstoRequestDate: '2026-06-30' }]],
    ['line-percent', [{ weldControlPercent: '10' }, { weldControlPercent: '20' }]],
    ['line-group', [{ groupName: 'A' }, { groupName: 'B' }]],
    ['line-category', [{ category: 'I' }, { category: 'II' }]],
    ['line-control-presence', [{ weldControlPercent: '100', hasRk: 'да' }, { weldControlPercent: '100', hasPvk: 'да' }]],
    ['welder-stamp-expiry', [], []],
    ['welder-dls-expiry', [], []],
    ['line-psto-presence', [{ pstoRequired: 'да' }, { pstoRequired: null }]],
    ['check-joint-core-data', [{ materialGroup: null }]],
    ['check-lnk-result-completeness', [{ vikResult: 'годен', vikConclusionDate: null, vikConclusion: null }]],
    ['check-psto-result-completeness', [{ pstoRequired: 'да', pstoResult: 'проведено', pstoDate: null }]],
    ['check-control-history', [{ hasRk: null, rkResult: 'годен' }]],
  ]
  return cases.map(([settingId, values, expected], caseIndex) => {
    const offset = (caseIndex + 1) * 100
    const rows = values.map((partial, index): WeldRow => ({
      id: offset + index + 1,
      projectTitle: `MATRIX ${settingId}`,
      subtitleCode: 'M-1', line: 'L1', joint: `S${index + 1}`,
      officiality: 'действующий', revisionActuality: 'актуальная',
      weldDate: '2026-07-01', weldControlPercent: '10',
      weldingMethod: 'РД', connectionType: 'СШ', materialGroup: 'M01',
      d1: 108, d2: 108, t1: 4, t2: 4, wdi: 0.42,
      stamp1K: 'A1', stamp1KFact: 'A1', hasVik: 'да',
      ...partial,
    }))
    return {
      settingId, rows,
      expectedRowIds: expected ? expected.map((id) => offset + id) : rows.map(({ id }) => id),
      welderStamps: settingId === 'welder-stamp-expiry' || settingId === 'welder-dls-expiry'
        ? [expiryStamp(offset, settingId)] : [],
    }
  })
}

function rejectedPercentageRows(): Partial<WeldRow>[] {
  return Array.from({ length: 6 }, (_, index) => ({
    rkResult: index < 4 ? 'вырез' : null,
    rkConclusionDate: index < 4 ? `2026-07-0${index + 2}` : null,
  }))
}

function expiryStamp(id: number, settingId: string): WelderStampRecord {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() + 7)
  const permit = {
    id: 'permit-1', weldType: 'РД', materialGroups: 'M01', diameterFrom: '1', diameterTo: '1000',
    thicknessFrom: '1', thicknessTo: '1000', validFrom: '2026-01-01', validTo: end.toISOString().slice(0, 10), note: '',
  }
  return {
    ...permit, id, naksStamp: `EXP-${id}`, welderName: 'Тестовый сварщик', internalStamp: '',
    naksPermits: settingId === 'welder-stamp-expiry' ? [permit] : [],
    dlsPermits: settingId === 'welder-dls-expiry' ? [{ ...permit, number: 'ДЛС-1' }] : [],
    archived: false,
  }
}
