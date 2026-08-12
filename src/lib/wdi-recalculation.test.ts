import { describe, expect, it } from 'vitest'
import { DEFAULT_OTHER_SETTINGS, WDI_CALCULATION_RULE_PRESETS } from './other-settings'
import { buildWdiRecalculationPlan, getWdiCalculationSignature } from './wdi-recalculation'

describe('WDI recalculation preview', () => {
  const settings = {
    ...DEFAULT_OTHER_SETTINGS,
    wdiCalculationMode: 'formula' as const,
  }

  it('shows before and after values and separates filled and cleared rows', () => {
    const plan = buildWdiRecalculationPlan([
      createRow({ id: 1, d1: 25.4, wdi: null }),
      createRow({ id: 2, d1: 50.8, wdi: 1 }),
      createRow({ id: 3, d1: null, d2: null, wdi: 3 }),
      createRow({ id: 4, d1: 25.4, wdi: 1 }),
      createRow({ id: 5, d1: 25.4, wdi: 1.001 }),
    ], settings)

    expect(plan).toMatchObject({ total: 5, changed: 4, unchanged: 1, wdiDelta: -1.001, filled: 1, cleared: 1 })
    expect(plan.examples.map(({ id, before, after }) => ({ id, before, after }))).toEqual([
      { id: 1, before: null, after: 1 },
      { id: 2, before: 1, after: 2 },
      { id: 3, before: 3, after: null },
      { id: 5, before: 1.001, after: 1 },
    ])
  })

  it('includes the calculation rule in the confirmation signature', () => {
    const maximumSettings = { ...settings, wdiCalculationRules: WDI_CALCULATION_RULE_PRESETS.maximum }
    expect(getWdiCalculationSignature(maximumSettings)).not.toBe(getWdiCalculationSignature(settings))
  })

  it('rejects recalculation in manual mode', () => {
    expect(() => buildWdiRecalculationPlan([], DEFAULT_OTHER_SETTINGS)).toThrow('системного расчета')
  })
})

function createRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    projectTitle: 'Проект',
    subtitleCode: 'Титул',
    line: 'Линия',
    joint: '1',
    connectionType: 'С17',
    d1: null,
    d2: null,
    t1: null,
    t2: null,
    wdi: null,
    ...overrides,
  }
}
