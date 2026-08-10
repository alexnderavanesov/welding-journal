import { spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { imageSize } from 'image-size'
import { describe, expect, it } from 'vitest'

const MALFORMED_IMAGE_CHECK = `
  import { imageSize } from 'image-size'

  const input = Buffer.from(process.argv[1], 'base64')
  try {
    imageSize(input)
    process.exitCode = 2
  } catch (error) {
    process.stdout.write(String(error))
  }
`

const writeBox = (buffer: Buffer, offset: number, size: number, name: string) => {
  buffer.writeUInt32BE(size, offset)
  buffer.write(name, offset + 4, 4, 'ascii')
}

const malformedIcns = () => {
  const buffer = Buffer.alloc(16)
  buffer.write('icns', 0, 4, 'ascii')
  buffer.writeUInt32BE(buffer.length, 4)
  buffer.write('ic07', 8, 4, 'ascii')
  buffer.writeUInt32BE(0, 12)
  return buffer
}

const malformedJxl = () => {
  const buffer = Buffer.alloc(40)
  writeBox(buffer, 0, 12, 'JXL ')
  writeBox(buffer, 12, 12, 'ftyp')
  buffer.write('jxl ', 20, 4, 'ascii')
  writeBox(buffer, 24, 0, 'jxlp')
  return buffer
}

const malformedHeif = () => {
  const buffer = Buffer.alloc(64)
  writeBox(buffer, 0, 12, 'ftyp')
  buffer.write('mif1', 8, 4, 'ascii')
  writeBox(buffer, 12, 52, 'meta')
  writeBox(buffer, 24, 40, 'iprp')
  writeBox(buffer, 32, 32, 'ipco')
  writeBox(buffer, 40, 0, 'ispe')
  return buffer
}

describe('image-size security build', () => {
  it.each([
    ['ICNS', malformedIcns()],
    ['JXL', malformedJxl()],
    ['HEIF', malformedHeif()],
  ])('rejects malformed %s data without hanging', (_type, input) => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', MALFORMED_IMAGE_CHECK, input.toString('base64')],
      { encoding: 'utf8', timeout: 1_000 },
    )

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Invalid')
  })

  it('still reads an ordinary PNG', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJ8AAAAASUVORK5CYII=',
      'base64',
    )

    expect(imageSize(png)).toMatchObject({ height: 1, type: 'png', width: 1 })
  })
})
