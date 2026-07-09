import type { WeldRow } from '@/lib/dispatcher-types'

export type DocumentGenerationRequest = {
  id: number
  type: 'weldingJournal'
  rows: WeldRow[]
}
