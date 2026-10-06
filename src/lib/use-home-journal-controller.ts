import { useState } from 'react'

import { useHomeWeldEditorController } from '@/lib/use-home-weld-editor-controller'

export function useHomeJournalController() {
  const editor = useHomeWeldEditorController()
  const [coilRestorationRootId, setCoilRestorationRootId] = useState<number | null>(null)
  const [coilCorrectionReturnId, setCoilCorrectionReturnId] = useState<number | null>(null)
  const [chainActuality, setChainActuality] = useState<{ rowId: number; active: boolean } | null>(null)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  return {
    ...editor,
    coilRestorationRootId,
    setCoilRestorationRootId,
    coilCorrectionReturnId,
    setCoilCorrectionReturnId,
    chainActuality,
    setChainActuality,
    isImportDialogOpen,
    setIsImportDialogOpen,
  }
}
