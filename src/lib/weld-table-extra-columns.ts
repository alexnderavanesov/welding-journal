import type { ReactNode } from 'react'

import type { WeldRow } from '@/lib/dispatcher-types'

export type WeldTableExtraColumn = {
  key: string
  section: string
  label: string
  width: number
  insertBeforeSection?: string
  renderCell: (row: WeldRow) => ReactNode
}
