import { beforeEach, describe, expect, it } from 'vitest'
import { applyRemoteControlProcessSettings, DEFAULT_CONTROL_PROCESS_SETTINGS, loadControlProcessSettings, normalizeControlProcessSettings, saveControlProcessSettings } from './control-process-settings'

describe('control process modes and legacy settings', () => {
  beforeEach(() => window.localStorage.clear())
  it('always selects individual joints even with legacy mode settings', () => {
    expect(normalizeControlProcessSettings(null)).toEqual({ pvkGoodOnly: false, preHeatTreatmentMode: 'selected' as const })
    expect(normalizeControlProcessSettings({ pvkGoodOnly: false }).preHeatTreatmentMode).toBe('selected')
    expect(normalizeControlProcessSettings({ preHeatTreatmentLnkEnabled: true }).preHeatTreatmentMode).toBe('selected')
    expect(normalizeControlProcessSettings({ preHeatTreatmentLnkEnabled: false }).preHeatTreatmentMode).toBe('selected')
  })
  it.each([true, false])('ignores the retired primary restriction (%s)', old => {
    expect(normalizeControlProcessSettings({ preHeatTreatmentMode: 'selected', allowPrimaryLnkBeforePreviousStagesComplete: old })).toEqual(DEFAULT_CONTROL_PROCESS_SETTINGS)
  })
  it('ignores retired allPsto values and accepts other remote settings', () => {
    saveControlProcessSettings({ pvkGoodOnly: false, preHeatTreatmentMode: 'allPsto' as const }, { syncRemote: false })
    expect(loadControlProcessSettings()).toEqual({ pvkGoodOnly: false, preHeatTreatmentMode: 'selected' as const })
    applyRemoteControlProcessSettings({ pvkGoodOnly: true, preHeatTreatmentLnkEnabled: false })
    expect(loadControlProcessSettings()).toEqual({ pvkGoodOnly: true, preHeatTreatmentMode: 'selected' as const })
  })
})
