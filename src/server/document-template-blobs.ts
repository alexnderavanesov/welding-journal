import { randomUUID } from 'node:crypto'

export type DocumentTemplateBlobStore = {
  delete: (key: string) => Promise<void>
  list: (options: {
    prefix: string
    paginate: true
  }) => AsyncIterable<{
    blobs: Array<{ key: string }>
  }>
}

export function createDocumentTemplateBlobKey(templateId: string, fileType: string) {
  const extension = fileType.toLowerCase().replace(/[^a-z0-9]/g, '') || 'xlsx'
  return `${templateId}/${Date.now()}-${randomUUID()}.${extension}`
}

export async function deleteDocumentTemplateBlobVersions(
  store: DocumentTemplateBlobStore,
  templateId: string,
  options: {
    keepKey?: string
    activeKey?: string
  } = {},
) {
  const prefix = `${templateId}/`
  const keys = new Set<string>()
  for await (const page of store.list({ prefix, paginate: true })) {
    for (const blob of page.blobs) {
      const key = decodeBlobKey(blob.key)
      if (key.startsWith(prefix) && key !== options.keepKey) keys.add(key)
    }
  }

  const orderedKeys = Array.from(keys).sort((left, right) => {
    if (left === options.activeKey) return 1
    if (right === options.activeKey) return -1
    return left.localeCompare(right, 'ru', { numeric: true })
  })
  for (const key of orderedKeys) await store.delete(key)
  return orderedKeys
}

function decodeBlobKey(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
