import { describe, expect, it } from 'vitest'
import { assertImportedWeldFields } from './access-payload'

describe('preliminary control import boundary', () => {
  it.each([true, false, null])('rejects raw import of the chain flag %s even on a new joint', preHeatTreatmentRequired => {
    expect(() => assertImportedWeldFields({ joint: 'F1', preHeatTreatmentRequired })).toThrow('НК до ТО')
  })
  it.each([true, false, null])('never accepts the flag %s as an existing-row import column', preHeatTreatmentRequired => {
    expect(() => assertImportedWeldFields({ id: 1, preHeatTreatmentRequired }, { id: 1, preHeatTreatmentRequired: true })).toThrow('НК до ТО')
  })
  it('allows ordinary import fields so the server can derive the chain requirement', () => {
    expect(() => assertImportedWeldFields({ joint: 'F1R1', line: 'L', weldingJournalNote: 'Imported' })).not.toThrow()
    expect(() => assertImportedWeldFields({ id: 1, weldingJournalNote: 'Imported' }, { id: 1, preHeatTreatmentRequired: true })).not.toThrow()
  })
})
