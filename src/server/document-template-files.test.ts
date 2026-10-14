import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  createDocumentTemplateFileStore,
  createDocumentTemplateFileKey,
  deleteDocumentTemplateFileVersions,
  resolveDocumentTemplateStorageDirectory,
  hasPersistentTemplateMount,
  type DocumentTemplateFileStore,
} from '@/server/document-template-files'

describe('document template files', () => {
  it('requires durable storage rather than the container layer or a temporary memory mount', () => {
    const overlay = '1 0 0:1 / / rw - overlay overlay rw'
    const disk = '2 1 8:1 /volumes/templates /app/data rw - ext4 /dev/sda rw'
    expect(hasPersistentTemplateMount('/app/data/document-templates', overlay)).toBe(false)
    expect(hasPersistentTemplateMount('/app/data/document-templates', `${overlay}\n${disk}`)).toBe(true)
    expect(hasPersistentTemplateMount('/app/database/templates', `${overlay}\n${disk}`)).toBe(false)
    expect(hasPersistentTemplateMount('/app/data/document-templates', `${overlay}\n${disk}\n3 2 0:2 / /app/data/document-templates rw - tmpfs tmpfs rw`)).toBe(false)
  })
  it('survives reopening the store and never publishes a partial file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'document-template-files-'))
    try {
      const first = createDocumentTemplateFileStore(directory)
      const bytes = new Uint8Array([1, 5, 9]).buffer
      await first.set('checklist/restart.xlsx', bytes)
      const restarted = createDocumentTemplateFileStore(directory)
      expect(await restarted.get('checklist/restart.xlsx')).toEqual(bytes)
      expect(await restarted.list('checklist/')).toEqual(['checklist/restart.xlsx'])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('uses the persistent data directory by default and accepts an override', () => {
    expect(resolveDocumentTemplateStorageDirectory('/app')).toBe('/app/data/document-templates')
    expect(resolveDocumentTemplateStorageDirectory('/app', '/mnt/templates')).toBe('/mnt/templates')
  })

  it('stores, lists, reads, and deletes template files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'document-template-files-'))
    const store = createDocumentTemplateFileStore(directory)
    const key = 'checklist/template.xlsx'

    try {
      await store.set(key, new Uint8Array([1, 2, 3]).buffer)
      expect(Array.from(new Uint8Array((await store.get(key))!))).toEqual([1, 2, 3])
      expect(await store.list('checklist/')).toEqual([key])
      await store.delete(key)
      expect(await store.get(key)).toBeNull()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects paths outside the configured storage directory', async () => {
    const store = createDocumentTemplateFileStore('/tmp/document-template-files')
    await expect(store.set('../outside.xlsx', new ArrayBuffer(1))).rejects.toThrow(
      'Недопустимый путь файла шаблона.',
    )
  })

  it('uses an internal ASCII key instead of the original localized file name', () => {
    const key = createDocumentTemplateFileKey('checklist', 'XLSX')
    expect(key).toMatch(/^checklist\/\d+-[0-9a-f-]+\.xlsx$/)
    expect(key).not.toContain('Чек-лист')
  })

  it('deletes every stored version and keeps the active file until last', async () => {
    const deleted: string[] = []
    const store = createStore([
      'checklist/100-old.xlsx',
      'checklist/200-current.xlsx',
      'checklist/150-old.xlsx',
    ], deleted)
    const keys = await deleteDocumentTemplateFileVersions(store, 'checklist', {
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
    const store = createStore([
      'checklist/100-old.xlsx',
      'checklist/200-current.xlsx',
    ], deleted)
    await deleteDocumentTemplateFileVersions(store, 'checklist', {
      keepKey: 'checklist/200-current.xlsx',
    })
    expect(deleted).toEqual(['checklist/100-old.xlsx'])
  })

  it('does not hide a storage deletion error', async () => {
    const store = createStore(['checklist/old.xlsx'], [])
    vi.mocked(store.delete).mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(deleteDocumentTemplateFileVersions(store, 'checklist')).rejects.toThrow('storage unavailable')
  })
})

function createStore(keys: string[], deleted: string[]): DocumentTemplateFileStore {
  return {
    delete: vi.fn(async (key: string) => {
      deleted.push(key)
    }),
    get: vi.fn(async () => null),
    list: vi.fn(async () => keys),
    set: vi.fn(async () => undefined),
  }
}
