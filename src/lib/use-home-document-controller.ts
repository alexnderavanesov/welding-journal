import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { DocumentGenerationRequest } from '@/lib/document-generation'
import type { DocumentNavigationRequest } from '@/lib/document-navigation'
import {
  getGeneratedDocumentProfile,
  isGeneratedDocumentFieldKey,
} from '@/lib/generated-document-types'
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
    const previewWindow = openDocumentPreviewWindow()
    if (!previewWindow) return
    const openDocument = isGeneratedDocumentFieldKey(fieldKey)
      ? import('@/lib/welding-journal-document').then(({ openGeneratedDocumentForRow }) =>
          openGeneratedDocumentForRow(row, fieldKey, welderStamps, previewWindow),
        )
      : import('@/lib/system-document-storage').then(({ openSystemDocumentForRow }) =>
          openSystemDocumentForRow(row, fieldKey, welderStamps, previewWindow),
        )
    void openDocument.catch((reason) => writeDocumentPreviewImportError(previewWindow, reason))
  }, [welderStamps])

  return {
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

function openDocumentPreviewWindow() {
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) {
    window.alert('Браузер заблокировал открытие новой вкладки.')
    return null
  }
  previewWindow.opener = null
  previewWindow.document.title = 'Подготовка документа'
  previewWindow.document.body.textContent = 'Подготавливаем документ...'
  return previewWindow
}

function writeDocumentPreviewImportError(previewWindow: Window, reason: unknown) {
  if (previewWindow.closed) return
  previewWindow.document.title = 'Не удалось открыть документ'
  previewWindow.document.body.textContent =
    reason instanceof Error ? reason.message : 'Не удалось загрузить модуль документа.'
}
