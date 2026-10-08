import { useState } from 'react'
import type { CoilCorrectionTarget } from '@/components/coil-correction-checklist'

import { useHomeWeldEditorController } from '@/lib/use-home-weld-editor-controller'

export function useHomeJournalController() {
  const editor = useHomeWeldEditorController()
  const [coilCorrectionTarget, setCoilCorrectionTarget] = useState<CoilCorrectionTarget | null>(null)
  const [coilCorrectionReturnTarget, setCoilCorrectionReturnTarget] = useState<CoilCorrectionTarget | null>(null)
  const [chainActuality, setChainActuality] = useState<{ rowId: number; active: boolean } | null>(null)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  return {
    ...editor,
    coilCorrectionTarget,
    setCoilCorrectionTarget,
    coilCorrectionReturnTarget,
    setCoilCorrectionReturnTarget,
    chainActuality,
    setChainActuality,
    isImportDialogOpen,
    setIsImportDialogOpen,
  }
}
