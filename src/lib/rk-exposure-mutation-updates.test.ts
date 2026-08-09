import { describe, expect, it } from 'vitest'
import { buildRkExposureEditedRow } from '@/lib/rk-exposure-mutation-updates'

describe('RK exposure editor updates', () => {
  it('stores descriptions and the diameter confirmed by the user', () => {
    const updated = buildRkExposureEditedRow({
      record: { id: 7, joint: 'F7', rkResult: 'ремонт' },
      lines: [
        { coordinate: '0-100', description: 'дефект 1а' },
        { coordinate: '100-0', description: '' },
      ],
      confirmedDiameter: 89,
    })

    expect(updated.lnkDefectDescription).toBe('0-100: дефект 1а\n100-0:')
    expect(updated.rkExposureConfirmedDiameter).toBe(89)
    expect(updated.lnkCreatedAt).toBeTruthy()
  })

  it('rejects empty and duplicate coordinates', () => {
    expect(() => buildRkExposureEditedRow({
      record: { id: 7 },
      lines: [{ coordinate: '', description: 'ДНО' }],
      confirmedDiameter: 89,
    })).toThrow('Добавьте хотя бы один снимок')

    expect(() => buildRkExposureEditedRow({
      record: { id: 7 },
      lines: [
        { coordinate: '1', description: 'ДНО' },
        { coordinate: '1', description: 'ДНО' },
      ],
      confirmedDiameter: 89,
    })).toThrow('не должны повторяться')
  })
})
