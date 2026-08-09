import { render, screen } from '@testing-library/react'
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

    expect(screen.getByRole('button', { name: 'удалить результат' })).toBeDisabled()
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

    expect(screen.getByRole('button', { name: 'удалить результат' })).toBeEnabled()
    expect(screen.queryByText(/Результат ВИК нельзя удалить/)).not.toBeInTheDocument()
  })
})
