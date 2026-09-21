import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type { DocumentsPageType } from '@/components/documents-page'
import type { WeldRow } from '@/lib/dispatcher-types'
import {
  DEFAULT_JOINT_PICTURE_INTENT,
  type OpenJointPictureOptions,
} from '@/lib/joint-picture-navigation'

export function useReportPageUiState() {
  const [chainRecord, setChainRecordState] = useState<WeldRow | null>(null)
  const [chainPictureIntent, setChainPictureIntent] = useState(DEFAULT_JOINT_PICTURE_INTENT)
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
  const setChainRecord = useCallback<Dispatch<SetStateAction<WeldRow | null>>>((value) => {
    setChainPictureIntent(DEFAULT_JOINT_PICTURE_INTENT)
    setChainRecordState(value)
  }, [])
  const openChainPicture = useCallback((row: WeldRow, options: OpenJointPictureOptions = {}) => {
    setChainPictureIntent({
      initialTab: options.initialTab ?? 'joint',
      focusedTaskKey: options.focusedTaskKey ?? null,
    })
    setChainRecordState(row)
  }, [])

  return {
    chainRecord,
    chainPictureIntent,
    message,
    lnkNotice,
    documentsPageType,
    setChainRecord,
    openChainPicture,
    setMessage,
    setLnkNotice,
    setDocumentsPageType,
  }
}
