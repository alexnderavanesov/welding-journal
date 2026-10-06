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

  it('defaults PVK-good-only off without changing pre-heat policy', () => {
    expect(normalizeControlProcessSettings(null)).toEqual(DEFAULT_CONTROL_PROCESS_SETTINGS)
    expect(normalizeControlProcessSettings({ pvkGoodOnly: false })).toEqual({
      pvkGoodOnly: false,
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
    expect(normalizeControlProcessSettings({ preHeatTreatmentLnkEnabled: false })).toEqual({
      pvkGoodOnly: false,
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
  })

  it('persists the normalized local snapshot', () => {
    saveControlProcessSettings({
      pvkGoodOnly: false,
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    }, { syncRemote: false })

    expect(loadControlProcessSettings()).toEqual({
      pvkGoodOnly: false,
      preHeatTreatmentLnkEnabled: true,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
  })

  it('applies the authoritative project snapshot without a remote echo', () => {
    applyRemoteControlProcessSettings({
      pvkGoodOnly: true,
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })

    expect(loadControlProcessSettings()).toEqual({
      pvkGoodOnly: true,
      preHeatTreatmentLnkEnabled: false,
      allowPrimaryLnkBeforePreviousStagesComplete: false,
    })
  })
})
