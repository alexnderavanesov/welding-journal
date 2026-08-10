import { describe, expect, it } from 'vitest'
import { getAcceptedWarningContextParts } from '@/lib/dispatcher-accepted-warning-display'

describe('getAcceptedWarningContextParts', () => {
  it('adds labels to previously saved unlabeled context', () => {
    expect(getAcceptedWarningContextParts({
      key: 'unused',
      kind: 'percentage-line-control',
      context: 'Риформинг · 400 · LIN-000-11-31 · ABC1',
    })).toEqual([
      { label: 'Проект', value: 'Риформинг' },
      { label: 'Шифр', value: '400' },
      { label: 'Линия', value: 'LIN-000-11-31' },
      { label: 'Клеймо', value: 'ABC1' },
    ])
  })

  it('keeps labels saved by the current version', () => {
    expect(getAcceptedWarningContextParts({
      key: 'unused',
      kind: 'percentage-line-control',
      context: 'Проект: Риформинг · Линия: LIN-000-11-31 · Клеймо: ABC1',
    })).toEqual([
      { label: 'Проект', value: 'Риформинг' },
      { label: 'Линия', value: 'LIN-000-11-31' },
      { label: 'Клеймо', value: 'ABC1' },
    ])
  })

  it('restores useful context from a legacy percentage-line key', () => {
    expect(getAcceptedWarningContextParts({
      key: 'percentage-line-control:rejected-primary:риформинг|400|lin-243-11-31|abc1:1:128',
      kind: 'percentage-line-control',
      context: '',
    })).toEqual([
      { label: 'Проект', value: 'риформинг' },
      { label: 'Шифр', value: '400' },
      { label: 'Линия', value: 'lin-243-11-31' },
      { label: 'Клеймо', value: 'ABC1' },
    ])
  })
})
