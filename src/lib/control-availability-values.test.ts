import { describe, expect, it } from 'vitest'

import {
  getControlAvailabilityFilterAliases,
  isControlDisabledValue,
  isControlEnabledValue,
  isRecognizedControlAvailabilityValue,
  normalizeControlAvailabilityFilterValue,
  normalizeControlAvailabilityStorageText,
  normalizeControlAvailabilityText,
} from '@/lib/control-availability-values'

describe('control availability values', () => {
  it('fast canonical normalization preserves aliases, unknown values and non-string inputs', () => {
    for (const value of [null, undefined, '', 'да', 'нет', 'отменен', 'дополнительный', true, false, 0, 1,
      ' YES ', ' ЗАМЕНА РК/УЗК ', ' Нестандартное значение ', { toString: () => ' Да ' }]) {
      const normalized = String(value ?? '').trim().toLowerCase()
      expect(normalizeControlAvailabilityText(value)).toBe(normalized === 'замена рк/узк' ? 'дополнительный' : normalized)
    }
  })
  it.each([
    ['Да', 'да'],
    ['ДА', 'да'],
    ['yes', 'да'],
    ['1', 'да'],
    [true, 'да'],
    ['Нет', ''],
    ['НЕТ', ''],
    ['no', ''],
    ['0', ''],
    [false, ''],
    ['-', ''],
    [null, ''],
  ])('normalizes %j for filters', (value, expected) => {
    expect(normalizeControlAvailabilityFilterValue(value)).toBe(expected)
  })

  it('keeps special assignment states canonical', () => {
    expect(normalizeControlAvailabilityFilterValue('Отменен')).toBe('отменен')
    expect(normalizeControlAvailabilityFilterValue('Дополнительный')).toBe('дополнительный')
    expect(normalizeControlAvailabilityFilterValue('замена РК/УЗК')).toBe('дополнительный')
  })

  it('recognizes supported import aliases and rejects arbitrary text', () => {
    expect(isRecognizedControlAvailabilityValue('Да')).toBe(true)
    expect(isRecognizedControlAvailabilityValue('0')).toBe(true)
    expect(isRecognizedControlAvailabilityValue('возможно')).toBe(false)
    expect(isControlEnabledValue('1')).toBe(true)
    expect(isControlDisabledValue('Нет')).toBe(true)
  })

  it('expands canonical filter values to all supported stored aliases', () => {
    expect(getControlAvailabilityFilterAliases('да')).toContain('1')
    expect(getControlAvailabilityFilterAliases('')).toEqual(expect.arrayContaining(['', 'нет', '0']))
    expect(getControlAvailabilityFilterAliases('нет')).toEqual(expect.arrayContaining(['', 'нет', '0']))
    expect(normalizeControlAvailabilityStorageText(' Да ')).toBe('да')
    expect(normalizeControlAvailabilityStorageText(' НЕТ ')).toBeNull()
  })
})
