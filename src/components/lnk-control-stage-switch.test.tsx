import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LnkControlStageSwitch } from '@/components/lnk-control-stage-switch'

describe('LnkControlStageSwitch', () => {
  it('shows pre-TO before primary and reports the selected stage', () => {
    const onChange = vi.fn()
    render(
      <LnkControlStageSwitch
        value="primary"
        onChange={onChange}
      />,
    )

    const stageButtons = within(screen.getByRole('group', { name: 'Этап контроля ЛНК' }))
      .getAllByRole('button')
    expect(stageButtons.map((button) => button.textContent)).toEqual(['До ТО', 'Основной'])

    fireEvent.click(stageButtons[0]!)
    expect(onChange).toHaveBeenCalledWith('beforeHeatTreatment')
  })
})
