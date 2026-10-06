import type { SystemDocumentRebuildPreview } from './system-document-rebuild'

/** Avoid RPC reference nodes for every primitive. Bound serialization by one
 * document, not the entire journal (which may exceed V8's string limit). */
export function encodeRebuildPreview(preview: SystemDocumentRebuildPreview) {
  const { documents, ...summary } = preview
  return { ...summary, documentsJson: documents.map(document => JSON.stringify(document)) }
}

export function decodeRebuildPreview(preview: ReturnType<typeof encodeRebuildPreview>): SystemDocumentRebuildPreview {
  const { documentsJson, ...summary } = preview
  return { ...summary, documents: documentsJson.map(document => JSON.parse(document)) }
}
