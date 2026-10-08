import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LnkResultManagerActions } from '@/components/lnk-result-manager-actions'
import type { WeldRow } from '@/lib/dispatcher-types'
import { LNK_METHODS } from '@/lib/report-config'

const row = {
  id: 17,
  joint: 'F17',
  vikResult: 'годен',
  rkResult: 'годен',
  uzkResult: 'ремонт',
} as WeldRow

describe('LnkResultManagerActions', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps a stored forbidden result visible while explaining every reason and allowing correction', () => {
    const onReplaceResult = vi.fn()
    render(<LnkResultManagerActions row={{ ...row, joint: 'F17R2', d1: 57, layeredControlAssigned: true }}
      method={LNK_METHODS.find((method) => method.code === 'РК')!} currentResult="ремонт" pendingResult=""
      isResultCorrectionPending={false} isResultReplacementPending={false}
      onReplaceResult={onReplaceResult} onClearResult={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'ремонт' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.mouseEnter(screen.getByRole('group', { name: 'ремонт' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('меньше 89 мм')
    expect(screen.getByRole('tooltip')).toHaveTextContent('два ремонта')
    expect(screen.getByRole('tooltip')).toHaveTextContent('послойном контроле')
    fireEvent.click(screen.getByRole('button', { name: 'ремонт' }))
    expect(onReplaceResult).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'годен' }))
    expect(onReplaceResult).toHaveBeenCalledWith(expect.objectContaining({ id: row.id }), 'rkRequest', 'годен')
  })

  it('adds pvkGoodOnly to the method restriction for replacement results', () => {
    window.localStorage.setItem('welding-control-process-settings', JSON.stringify({ pvkGoodOnly: true }))
    render(<LnkResultManagerActions row={row} method={LNK_METHODS.find((method) => method.code === 'ПВК')!}
      currentResult="годен" pendingResult="" isResultCorrectionPending={false} isResultReplacementPending={false}
      onReplaceResult={vi.fn()} onClearResult={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'ремонт' })).toBeDisabled()
    fireEvent.focus(screen.getByRole('group', { name: 'вырез' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('По ПВК результат «вырез» не допускается.')
    expect(screen.getByRole('tooltip')).toHaveTextContent('ПВК — только годен')
  })

  it('shows why VIK cannot be removed while later NDT results exist', () => {
    const onClearResult = vi.fn()

    render(
      <LnkResultManagerActions
        row={row}
        method={LNK_METHODS[0]}
        currentResult="годен"
        pendingResult=""
        isResultCorrectionPending={false}
        isResultReplacementPending={false}
        onReplaceResult={vi.fn()}
        onClearResult={onClearResult}
      />,
    )

    expect(screen.getByRole('button', { name: 'Удалить результат' })).toBeDisabled()
    expect(screen.getByText(
      'Результат ВИК нельзя удалить, пока сохранены результаты следующих видов НК: РК, УЗК. Сначала удалите их результаты.',
    )).toBeInTheDocument()
    expect(onClearResult).not.toHaveBeenCalled()
  })

  it('does not apply the VIK dependency hint to another method', () => {
    render(
      <LnkResultManagerActions
        row={row}
        method={LNK_METHODS[1]}
        currentResult="годен"
        pendingResult=""
        isResultCorrectionPending={false}
        isResultReplacementPending={false}
        onReplaceResult={vi.fn()}
        onClearResult={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Удалить результат' })).toBeEnabled()
    expect(screen.queryByText(/Результат ВИК нельзя удалить/)).not.toBeInTheDocument()
  })
})
