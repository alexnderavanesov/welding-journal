import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import type { DocumentNavigationRequest } from '@/lib/document-navigation'
import { getGeneratedDocumentProfile } from '@/lib/generated-document-types'
import { createRowDocumentPreviewRequest } from '@/lib/row-document-preview'
import type { HistoryDocumentPreviewRequest } from '@/components/history-document-preview'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type UseHomeDocumentControllerOptions = {
  setMessage: (message: string) => void
  setGenerationMenuOpen: Dispatch<SetStateAction<boolean>>
  setShowMenuOpen: Dispatch<SetStateAction<boolean>>
  welderStamps: WelderStampRecord[]
}

export function useHomeDocumentController({
  setMessage,
  setGenerationMenuOpen,
  setShowMenuOpen,
  welderStamps,
}: UseHomeDocumentControllerOptions) {
  const [documentPreviewRequest, setDocumentPreviewRequest] = useState<HistoryDocumentPreviewRequest | null>(null)
  const closeDocumentPreview = useCallback(() => setDocumentPreviewRequest(null), [])
  const [documentGenerationRequest, setDocumentGenerationRequest] =
    useState<DocumentGenerationRequest | null>(null)
  const [documentNavigationRequest, setDocumentNavigationRequest] =
    useState<DocumentNavigationRequest | null>(null)

  const generateDocumentForRows = useCallback((
    type: DocumentGenerationRequest['type'],
    rows: WeldRow[],
  ) => {
    const documentLabel = getGeneratedDocumentProfile(type).formationLabel
    if (rows.length === 0) {
      setMessage(`Нет стыков для формирования ${documentLabel}.`)
      return
    }
    setDocumentGenerationRequest({ id: Date.now(), type, rows })
    setGenerationMenuOpen(false)
    setShowMenuOpen(false)
  }, [setGenerationMenuOpen, setMessage, setShowMenuOpen])

  const handleDocumentGenerationRequest = useCallback((requestId: number) => {
    setDocumentGenerationRequest((current) => (current?.id === requestId ? null : current))
  }, [])

  const handleDocumentNavigationRequest = useCallback((requestId: number) => {
    setDocumentNavigationRequest((current) =>
      current?.requestId === requestId ? null : current,
    )
  }, [])

  const openReportDocument = useCallback((row: WeldRow, fieldKey: WeldFieldKey) => {
    setDocumentPreviewRequest(createRowDocumentPreviewRequest(row, fieldKey, welderStamps))
  }, [welderStamps])

  return {
    documentPreviewRequest,
    closeDocumentPreview,
    documentGenerationRequest,
    setDocumentGenerationRequest,
    generateDocumentForRows,
    handleDocumentGenerationRequest,
    openReportDocument,
    documentNavigationRequest,
    setDocumentNavigationRequest,
    handleDocumentNavigationRequest,
  }
}
