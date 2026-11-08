import { beforeEach, describe, expect, it } from 'vitest'
import { applyRemoteControlProcessSettings, DEFAULT_CONTROL_PROCESS_SETTINGS, loadControlProcessSettings, normalizeControlProcessSettings, saveControlProcessSettings } from './control-process-settings'

describe('control process modes and legacy settings', () => {
  beforeEach(() => window.localStorage.clear())
  it('starts new projects in selected mode and preserves legacy enabled/disabled meaning', () => {
    expect(normalizeControlProcessSettings(null)).toEqual({ pvkGoodOnly: false, preHeatTreatmentMode: 'selected' as const })
    expect(normalizeControlProcessSettings({ pvkGoodOnly: false }).preHeatTreatmentMode).toBe('allPsto')
    expect(normalizeControlProcessSettings({ preHeatTreatmentLnkEnabled: true }).preHeatTreatmentMode).toBe('allPsto')
    expect(normalizeControlProcessSettings({ preHeatTreatmentLnkEnabled: false }).preHeatTreatmentMode).toBe('selected')
  })
  it.each([true, false])('ignores the retired primary restriction (%s)', old => {
    expect(normalizeControlProcessSettings({ preHeatTreatmentMode: 'selected', allowPrimaryLnkBeforePreviousStagesComplete: old })).toEqual(DEFAULT_CONTROL_PROCESS_SETTINGS)
  })
  it('persists selected/allPsto without legacy keys and accepts authoritative remote settings', () => {
    saveControlProcessSettings({ pvkGoodOnly: false, preHeatTreatmentMode: 'allPsto' as const }, { syncRemote: false })
    expect(loadControlProcessSettings()).toEqual({ pvkGoodOnly: false, preHeatTreatmentMode: 'allPsto' as const })
    applyRemoteControlProcessSettings({ pvkGoodOnly: true, preHeatTreatmentLnkEnabled: false })
    expect(loadControlProcessSettings()).toEqual({ pvkGoodOnly: true, preHeatTreatmentMode: 'selected' as const })
  })
})
