import { useMemo } from 'react'
import { getJointChainRows } from '@/lib/repeated-joint-row-utils'
import { useWindowEscapeKey } from '@/lib/use-window-escape-key'
import type { WeldRow } from '@/lib/dispatcher-types'

type UseJointChainDialogStateOptions = {
  rows: WeldRow[]
  chainRecord: WeldRow | null
  onClose: () => void
}

export function useJointChainDialogState({
  rows,
  chainRecord,
  onClose,
}: UseJointChainDialogStateOptions) {
  const chainRows = useMemo(() => (chainRecord ? getJointChainRows(rows, chainRecord) : []), [chainRecord, rows])

  useWindowEscapeKey(Boolean(chainRecord), (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    onClose()
  })

  return {
    chainRows,
  }
}
