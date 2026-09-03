import type { WeldRow } from '@/lib/dispatcher-types'
import type { ManualGeneratedDocumentType } from '@/lib/generated-document-types'

export type DocumentGenerationRequest = {
  id: number
  type: ManualGeneratedDocumentType
  rows: WeldRow[]
}
