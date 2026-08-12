import { describe, expect, it } from 'vitest'

import {
  composeWeldTableCellTooltip,
  getWeldTableReadOnlyFieldTooltip,
} from '@/components/weld-table-body-cell'
import { LNK_METHODS } from '@/lib/lnk-report-config'

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

describe('getWeldTableReadOnlyFieldTooltip', () => {
  it('describes ordinary read-only report values as welding-journal data', () => {
    expect(getWeldTableReadOnlyFieldTooltip('isometry')).toBe(
      'Данные сварочного журнала. Чтобы изменить значение, откройте карточку стыка в разделе «Сварочный журнал».',
    )
  })

  it('describes every LNK request and result field by its actual workflow', () => {
    for (const method of LNK_METHODS) {
      expect(getWeldTableReadOnlyFieldTooltip(method.requestKey)).toContain('создании или изменении заявки')
      expect(getWeldTableReadOnlyFieldTooltip(method.requestDateKey)).toContain('создании или изменении заявки')
      expect(getWeldTableReadOnlyFieldTooltip(method.resultKey)).toContain('добавлении или редактировании результата')
      expect(getWeldTableReadOnlyFieldTooltip(method.conclusionDateKey)).toContain('добавлении или редактировании результата')
      expect(getWeldTableReadOnlyFieldTooltip(method.conclusionKey)).toContain('добавлении или редактировании результата')
    }
  })

  it('distinguishes PSTO requests, PSTO results and calculated statuses', () => {
    expect(getWeldTableReadOnlyFieldTooltip('pstoRequest')).toContain('создании или изменении заявки')
    expect(getWeldTableReadOnlyFieldTooltip('pstoRequestDate')).toContain('создании или изменении заявки')
    expect(getWeldTableReadOnlyFieldTooltip('pstoResult')).toContain('добавлении или редактировании результата')
    expect(getWeldTableReadOnlyFieldTooltip('pstoDate')).toContain('добавлении или редактировании результата')
    expect(getWeldTableReadOnlyFieldTooltip('heatTreatmentDiagram')).toContain('добавлении или редактировании результата')
    expect(getWeldTableReadOnlyFieldTooltip('status')).toContain('Сменить официальность')
    expect(getWeldTableReadOnlyFieldTooltip('finalStatus')).toContain('рассчитывается автоматически')
  })

  it('explains both supported WDI modes without calling an ordinary report field systemic', () => {
    expect(getWeldTableReadOnlyFieldTooltip('wdi')).toContain('В пользовательском режиме')
    expect(getWeldTableReadOnlyFieldTooltip('wdi')).toContain('в системном рассчитывается автоматически')
  })
})
