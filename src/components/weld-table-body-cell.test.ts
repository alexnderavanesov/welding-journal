import { describe, expect, it } from 'vitest'

import { composeWeldTableCellTooltip } from '@/components/weld-table-body-cell'

describe('composeWeldTableCellTooltip', () => {
  it('shows the complete cell value before the system-field explanation', () => {
    expect(composeWeldTableCellTooltip(
      'Заявка НК №400-00555555',
      'Системное поле: заполняется системой.',
    )).toBe('Заявка НК №400-00555555\n\nСистемное поле: заполняется системой.')
  })

  it('keeps only the explanation for an empty cell', () => {
    expect(composeWeldTableCellTooltip('', 'Системное поле.')).toBe('Системное поле.')
  })
})
