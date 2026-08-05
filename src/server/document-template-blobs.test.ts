import { getStore } from '@netlify/blobs'
import { BlobsServer } from '@netlify/blobs/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  createDocumentTemplateBlobKey,
  deleteDocumentTemplateBlobVersions,
  type DocumentTemplateBlobStore,
} from '@/server/document-template-blobs'

describe('document template blob cleanup', () => {
  it('uses an internal ASCII key instead of the original localized file name', () => {
    const key = createDocumentTemplateBlobKey('checklist', 'XLSX')

    expect(key).toMatch(/^checklist\/\d+-[0-9a-f-]+\.xlsx$/)
    expect(key).not.toContain('Чек-лист')
  })

  it('deletes every stored version and keeps the active file until last', async () => {
    const deleted: string[] = []
    const store = createStore(
      [
        ['checklist/100-old.xlsx', 'checklist/200-current.xlsx'],
        ['checklist/150-old.xlsx', 'weldingJournal/current.xlsx'],
      ],
      deleted,
    )

    const keys = await deleteDocumentTemplateBlobVersions(store, 'checklist', {
      activeKey: 'checklist/200-current.xlsx',
    })

    expect(keys).toEqual([
      'checklist/100-old.xlsx',
      'checklist/150-old.xlsx',
      'checklist/200-current.xlsx',
    ])
    expect(deleted).toEqual(keys)
  })

  it('keeps the newly saved version while removing previous files', async () => {
    const deleted: string[] = []
    const store = createStore(
      [['checklist/100-old.xlsx', 'checklist/200-current.xlsx']],
      deleted,
    )

    await deleteDocumentTemplateBlobVersions(store, 'checklist', {
      keepKey: 'checklist/200-current.xlsx',
    })

    expect(deleted).toEqual(['checklist/100-old.xlsx'])
  })

  it('recognizes a localized active key returned in URL-encoded form', async () => {
    const deleted: string[] = []
    const activeKey = 'checklist/200-ЧЕК-ЛИСТ.xlsx'
    const store = createStore(
      [[
        'checklist/100-%D0%A1%D0%A2%D0%90%D0%A0%D0%AB%D0%99.xlsx',
        'checklist/200-%D0%A7%D0%95%D0%9A-%D0%9B%D0%98%D0%A1%D0%A2.xlsx',
      ]],
      deleted,
    )

    await deleteDocumentTemplateBlobVersions(store, 'checklist', { keepKey: activeKey })

    expect(deleted).toEqual(['checklist/100-СТАРЫЙ.xlsx'])
  })

  it('keeps a newly saved template in the real local blob store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'document-template-blobs-'))
    const server = new BlobsServer({ directory, token: 'test-token' })
    const { address } = await server.start()
    const store = getStore({
      edgeURL: address,
      name: 'document-templates',
      siteID: '0',
      token: 'test-token',
    })
    const previousKey = 'checklist/100-СТАРЫЙ-ШАБЛОН.xlsx'
    const activeKey = createDocumentTemplateBlobKey('checklist', 'xlsx')

    try {
      await store.set(previousKey, new Uint8Array([1]))
      await store.set(activeKey, new Uint8Array([2, 3, 4]))
      await deleteDocumentTemplateBlobVersions(store, 'checklist', { keepKey: activeKey })

      expect(await store.get(previousKey, { type: 'arrayBuffer' })).toBeNull()
      expect(
        Array.from(new Uint8Array((await store.get(activeKey, { type: 'arrayBuffer' }))!)),
      ).toEqual([2, 3, 4])
    } finally {
      await server.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not hide a storage deletion error', async () => {
    const store = createStore([['checklist/old.xlsx']], [])
    vi.mocked(store.delete).mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(
      deleteDocumentTemplateBlobVersions(store, 'checklist'),
    ).rejects.toThrow('storage unavailable')
  })
})

function createStore(pages: string[][], deleted: string[]): DocumentTemplateBlobStore {
  return {
    delete: vi.fn(async (key: string) => {
      deleted.push(key)
    }),
    async *list() {
      for (const keys of pages) {
        yield { blobs: keys.map((key) => ({ key })) }
      }
    },
  }
}
