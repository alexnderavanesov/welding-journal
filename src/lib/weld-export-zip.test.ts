import { describe, expect, it } from 'vitest'

import { Blob as NodeBlob } from 'node:buffer'
import { createZip, createZipBlob } from '@/lib/weld-export-zip'

describe('createZip', () => {
  it('downloads identical bytes without concatenating the full archive, including sliced binary input and empty files', async () => {
    const NativeBlob = globalThis.Blob
    globalThis.Blob = NodeBlob as typeof Blob
    try {
      const binary = new Uint8Array([99, 0, 255, 50, 88]).subarray(1, 4)
      const files = [
        { path: 'ЖСР/Первый.xlsx', content: binary },
        { path: 'Текст.txt', content: 'Проверка UTF-8' },
        { path: 'Пустой.txt', content: new ArrayBuffer(0) },
      ]
      const blob = createZipBlob(files)
      expect(blob.type).toBe('application/zip')
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(createZip(files))
      binary[1] = 1
      // Blob must own a snapshot even though its input used views into buffers.
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const nameLength = new DataView(bytes.buffer).getUint16(26, true)
      expect([...bytes.slice(30 + nameLength, 33 + nameLength)]).toEqual([0, 255, 50])
    } finally { globalThis.Blob = NativeBlob }
  })
  it('stores binary files with utf-8 names without rewriting bytes', () => {
    const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff])
    const archive = createZip([{ path: 'ЖСР/Документ.xlsx', content }])
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const nameLength = view.getUint16(26, true)
    const contentOffset = 30 + nameLength

    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800)
    expect([...archive.slice(contentOffset, contentOffset + content.length)]).toEqual([...content])
  })
})
