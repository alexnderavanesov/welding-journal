import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WorkflowDialogShell } from '@/components/workflow-dialog-shell'

describe('WorkflowDialogShell', () => {
  it.each(['workflow', 'manager'] as const)('uses the same stable workspace dimensions for %s dialogs', (variant) => {
    render(<WorkflowDialogShell variant={variant}><div>Содержимое</div></WorkflowDialogShell>)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-w-[1480px]')
    expect(dialog.className).toContain('h-[calc(100dvh-1rem)]')
  })
})
