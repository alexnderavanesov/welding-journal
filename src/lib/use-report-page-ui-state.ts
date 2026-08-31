import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type { DocumentsPageType } from '@/components/documents-page'
import type { WeldRow } from '@/lib/dispatcher-types'

export function useReportPageUiState() {
  const [chainRecord, setChainRecord] = useState<WeldRow | null>(null)
  const [message, setMessageState] = useState<string | null>(null)
  const [lnkNotice, setLnkNoticeState] = useState<string | null>(null)
  const [documentsPageType, setDocumentsPageType] = useState<DocumentsPageType>('weldingJournal')

  const setMessage = useCallback<Dispatch<SetStateAction<string | null>>>((value) => {
    setLnkNoticeState(null)
    setMessageState(value)
  }, [])
  const setLnkNotice = useCallback<Dispatch<SetStateAction<string | null>>>((value) => {
    setMessageState(null)
    setLnkNoticeState(value)
  }, [])

  return {
    chainRecord,
    message,
    lnkNotice,
    documentsPageType,
    setChainRecord,
    setMessage,
    setLnkNotice,
    setDocumentsPageType,
  }
}
