import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyRemoteControlProcessSettings,
  DEFAULT_CONTROL_PROCESS_SETTINGS,
  loadControlProcessSettings,
  normalizeControlProcessSettings,
  saveControlProcessSettings,
} from '@/lib/control-process-settings'

describe('control process settings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps both independent processes enabled by default', () => {
    expect(normalizeControlProcessSettings(null)).toEqual(DEFAULT_CONTROL_PROCESS_SETTINGS)
    expect(normalizeControlProcessSettings({ layeredControlEnabled: false })).toEqual({
      layeredControlEnabled: false,
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
    expect(normalizeControlProcessSettings({ preHeatTreatmentLnkEnabled: false })).toEqual({
      layeredControlEnabled: true,
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
  })

  it('persists the normalized local snapshot', () => {
    saveControlProcessSettings({
      layeredControlEnabled: false,
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    }, { syncRemote: false })

    expect(loadControlProcessSettings()).toEqual({
      layeredControlEnabled: false,
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
  })

  it('applies the authoritative project snapshot without a remote echo', () => {
    applyRemoteControlProcessSettings({
      layeredControlEnabled: true,
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })

    expect(loadControlProcessSettings()).toEqual({
      layeredControlEnabled: true,
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
  })
})
