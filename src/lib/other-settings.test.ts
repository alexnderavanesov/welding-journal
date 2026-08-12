import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WDI_CALCULATION_RULES,
  normalizeOtherSettings,
  normalizeWdiCalculationRules,
} from './other-settings'

describe('WDI calculation rule settings', () => {
  it('applies the current agreed rule to legacy settings', () => {
    expect(normalizeOtherSettings({ wdiCalculationMode: 'formula' }).wdiCalculationRules).toEqual(
      DEFAULT_WDI_CALCULATION_RULES,
    )
  })

  it('normalizes each connection group independently', () => {
    expect(normalizeWdiCalculationRules({
      branch: { diameter: 'max', thickness: 'max', equalDiameterThickness: 'max' },
      other: { diameter: 'wrong', thickness: 'min', equalDiameterThickness: 'min' },
    })).toEqual({
      branch: { diameter: 'max', thickness: 'max', equalDiameterThickness: 'max' },
      other: { diameter: 'max', thickness: 'min', equalDiameterThickness: 'min' },
    })
  })
})
