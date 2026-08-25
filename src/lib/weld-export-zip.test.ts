import { describe, expect, it } from 'vitest'

import { createZip } from '@/lib/weld-export-zip'

describe('createZip', () => {
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
