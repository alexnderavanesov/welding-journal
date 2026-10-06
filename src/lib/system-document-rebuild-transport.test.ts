import { expect, it } from 'vitest'
import { encodeRebuildPreview, decodeRebuildPreview } from './system-document-rebuild-transport'
import { getSystemDocumentRebuildSelectionSummary, type SystemDocumentRebuildPreview } from './system-document-rebuild'

it.each([10, 200_000])('transports %i IDs losslessly without RPC reference expansion or truncation', count => {
  const rowIds = Array.from({ length: count }, (_, i) => i * 3 + 7).reverse()
  const preview = { fingerprint: 'settings', scopeRevisions: { pstoRequest: 'all-facts' }, documents: [
    { documentId: 1, templateId: 'pstoRequest', willChangeAutomatically: true,
      groups: [{ key: 'one', rowIds, rowCount: count, joints: ['S1'] }] },
    { documentId: 2, templateId: 'pstoRequest', willChangeAutomatically: true,
      groups: [{ key: 'two', rowIds: [7], rowCount: 1, joints: ['S1'] }] },
  ] } as SystemDocumentRebuildPreview
  const transport = encodeRebuildPreview(preview)
  expect(transport).not.toHaveProperty('documents')
  expect(transport.documentsJson).toHaveLength(2)
  expect(transport.documentsJson[0].length).toBeLessThan(count * 8 + 1024)
  const decoded = decodeRebuildPreview(transport)
  expect(decoded).toEqual(preview)
  expect(getSystemDocumentRebuildSelectionSummary({ documents: decoded.documents,
    selectedTemplateIds: new Set(['pstoRequest']), decisions: [] }).affectedRowCount).toBe(count)
})
