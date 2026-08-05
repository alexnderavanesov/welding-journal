import type { WeldRow } from '@/lib/dispatcher-types'
import type { GeneratedDocumentType } from '@/lib/generated-document-types'

export type DocumentGenerationRequest = {
  id: number
  type: GeneratedDocumentType
  rows: WeldRow[]
}
