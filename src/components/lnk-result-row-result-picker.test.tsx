import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LnkResultRowResultPicker } from '@/components/lnk-result-row-result-picker'
import type { WeldRow } from '@/lib/dispatcher-types'

describe('LnkResultRowResultPicker mandatory matrix', () => {
  beforeEach(() => window.localStorage.clear())

  it.each([
    ['ВИК', 57, 'F1', true, false],
    ['ПВК', 57, 'F1', true, false],
    ['ВИК', 89, 'F1', true, false],
    ['ПВК', 89, 'F1', true, false],
    ['ВИК', 57, 'F1R2', false, false],
    ['ПВК', 89, 'F1R2', false, false],
    ['РК', 57, 'F1', false, true],
    ['УЗК', 57, 'F1', false, true],
    ['РК', 89, 'F1', true, true],
    ['УЗК', 89, 'F1', true, true],
    ['РК', 89, 'F1R2', false, true],
    ['УЗК', 89, 'F1R2', false, true],
  ])('%s Dmin=%s %s: repair=%s, cutout=%s regardless of legacy toggle', (method, diameter, joint, repair, cutout) => {
    window.localStorage.setItem('welding-save-check-settings', JSON.stringify({ lnkResultRepairRules: false }))
    const onSetRowResult = vi.fn()
    render(<LnkResultRowResultPicker row={{ id: 1, joint, d1: 159, d2: diameter } as WeldRow}
      rowResult="" methodCode={String(method)} onSetRowResult={onSetRowResult} />)
    expect(screen.getByRole('button', { name: 'годен' })).toBeEnabled()
    for (const [result, allowed] of [['ремонт', repair], ['вырез', cutout]] as const) {
      const button = screen.getByRole('button', { name: result })
      if (allowed) expect(button).toBeEnabled()
      else {
        expect(button).toBeDisabled()
        fireEvent.focus(screen.getByRole('group', { name: result }))
        expect(screen.getByRole('tooltip')).not.toBeEmptyDOMElement()
        fireEvent.blur(screen.getByRole('group', { name: result }))
        fireEvent.click(button)
      }
    }
    expect(onSetRowResult).not.toHaveBeenCalled()
  })

  it('combines method, layered and pvk-only reasons and retains a previously selected forbidden value', () => {
    window.localStorage.setItem('welding-control-process-settings', JSON.stringify({ pvkGoodOnly: true }))
    const onSetRowResult = vi.fn()
    render(<LnkResultRowResultPicker row={{ id: 1, joint: 'F1R2', d1: 57 } as WeldRow}
      rowResult="вырез" methodCode="ПВК" layeredControlSelected onSetRowResult={onSetRowResult} />)
    expect(screen.getByRole('button', { name: 'вырез' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.focus(screen.getByRole('group', { name: 'вырез' }))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('По ПВК результат «вырез» не допускается.')
    expect(tooltip).toHaveTextContent('При послойном контроле')
    expect(tooltip).toHaveTextContent('ПВК — только годен')
    expect(onSetRowResult).not.toHaveBeenCalled()
  })
})
