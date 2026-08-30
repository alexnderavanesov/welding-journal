import { useEffect, useState } from 'react'
import type { WeldRow } from '@/lib/dispatcher-types'

export function useReportPageUiState() {
  const [chainRecord, setChainRecord] = useState<WeldRow | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lnkNotice, setLnkNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!lnkNotice) return undefined

    const timeoutId = window.setTimeout(() => setLnkNotice(null), 10000)
    return () => window.clearTimeout(timeoutId)
  }, [lnkNotice])

  return {
    chainRecord,
    message,
    lnkNotice,
    setChainRecord,
    setMessage,
    setLnkNotice,
  }
}
