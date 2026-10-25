import { SaxesParser } from 'saxes'
import { readCfbText, type CfbContainer } from './document-template-xlsx'

type XmlNode = { name: string; attrs: Record<string, string>; text: string; children: XmlNode[] }
function xml(source: string) {
  const root: XmlNode = { name: '', attrs: {}, text: '', children: [] }, stack = [root]
  const parser = new SaxesParser({ xmlns: true })
  parser.on('doctype', () => { throw new Error('DTD is not supported') })
  parser.on('opentag', tag => {
    const node: XmlNode = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value])), text: '', children: [] }
    stack.at(-1)!.children.push(node); stack.push(node)
  })
  parser.on('text', text => { stack.at(-1)!.text += text })
  parser.on('closetag', () => { stack.pop() })
  parser.write(source).close()
  return root
}
const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find(n => n.name === name)
function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap(n => n.name === name ? [n] : descendants(n, name))
}
function part(base: string, target: string) {
  if (!target || /[\\:?#]/.test(target) || target.startsWith('//')) return ''
  const pieces = target.startsWith('/') ? [] : base.split('/').slice(0, -1)
  for (const piece of target.split('/')) {
    if (piece === '..') { if (!pieces.length) return ''; pieces.pop() }
    else if (piece && piece !== '.') pieces.push(piece)
  }
  return pieces.join('/')
}
function relationships(container: CfbContainer, path: string) {
  const parts = path.split('/'), name = parts.pop()!
  const source = readCfbText(container, [...parts, '_rels', name + '.rels'].join('/'))
  return new Map(source ? descendants(xml(source), 'Relationship').filter(n => n.attrs.TargetMode !== 'External')
    .map(n => [n.attrs.Id, part(path, n.attrs.Target)]) : [])
}
export type SheetImage = {
  src: string; alt: string; from: { column: number; row: number; x: number; y: number }
  to?: { column: number; row: number; x: number; y: number }; width: number; height: number
  rotation: number; flipX: boolean; flipY: boolean; crop: number[]
  placement?: 'header' | 'footer'; align?: 'left' | 'center' | 'right'
}
const finite = (value: string | undefined) => Number.isFinite(Number(value)) ? Number(value) : 0
const emu = (value: string | undefined) => Number(value || 0) / 9525
function marker(node: XmlNode | undefined) {
  return { column: Number(child(node, 'col')?.text || 0), row: Number(child(node, 'row')?.text || 0),
    x: emu(child(node, 'colOff')?.text), y: emu(child(node, 'rowOff')?.text) }
}
function embeddedImage(container: CfbContainer, path: string | undefined) {
  const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' } as Record<string, string>)[path?.split('.').at(-1)?.toLowerCase() || '']
  const entry = container.FileIndex[container.FullPaths.findIndex(p => p.replace(/^Root Entry\//, '').replace(/^\//, '') === path)]
  if (!mime || !entry?.content) return null
  const bytes = new Uint8Array(entry.content as Uint8Array)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:${mime};base64,${btoa(binary)}`
}

/** Only embedded browser-readable images; never fetch relationships or execute SVG. */
export function readSheetImages(container: CfbContainer | undefined, sheetPath: string, sheetXml: string) {
  const images: SheetImage[] = []
  let unsupported = false
  if (!container) return { images, unsupported }
  try {
    const sheet = xml(sheetXml), links = relationships(container, sheetPath)
    unsupported = descendants(sheet, 'legacyDrawing').length > 0
    for (const reference of descendants(sheet, 'legacyDrawingHF')) {
      const path = links.get(reference.attrs.id)
      if (!path) { unsupported = true; continue }
      const media = relationships(container, path)
      for (const shape of descendants(xml(readCfbText(container, path) || ''), 'shape')) {
        const id = shape.attrs.id, data = child(shape, 'imagedata')
        const src = embeddedImage(container, media.get(data?.attrs.relid || ''))
        const dimension = (name: string) => {
          const match = shape.attrs.style?.match(new RegExp(`(?:^|;)\\s*${name}:([\\d.]+)(pt|px)`))
          return match ? Number(match[1]) * (match[2] === 'pt' ? 96 / 72 : 1) : 0
        }
        const width = dimension('width'), height = dimension('height')
        if (!src || !/^[LCR][HF](FIRST|EVEN)?$/.test(id) || !width || !height) { unsupported = true; continue }
        // A sheet has no printed page parity. Show its first/ordinary header once.
        if (id.endsWith('EVEN')) continue
        images.push({ src, alt: data?.attrs.title || 'Изображение колонтитула', from: { row: 0, column: 0, x: 0, y: 0 }, width, height,
          rotation: 0, flipX: false, flipY: false, crop: [0, 0, 0, 0], placement: id[1] === 'H' ? 'header' : 'footer',
          align: id[0] === 'L' ? 'left' : id[0] === 'R' ? 'right' : 'center' })
      }
    }
    for (const reference of descendants(sheet, 'drawing')) {
      const drawingPath = links.get(reference.attrs.id)
      if (!drawingPath) { unsupported = true; continue }
      const drawing = xml(readCfbText(container, drawingPath) || ''), media = relationships(container, drawingPath)
      for (const anchor of child(drawing, 'wsDr')?.children ?? []) {
        const picture = child(anchor, 'pic')
        if (!picture) { unsupported = true; continue }
        const blip = descendants(picture, 'blip')[0], mediaPath = media.get(blip?.attrs.embed)
        const src = embeddedImage(container, mediaPath)
        if (!src) { unsupported = true; continue }
        const transform = descendants(picture, 'xfrm')[0], size = child(anchor, 'ext') ?? child(transform, 'ext')
        const from = marker(child(anchor, 'from')), pos = child(anchor, 'pos')
        if (pos) { from.x = emu(pos.attrs.x); from.y = emu(pos.attrs.y) }
        // editAs=oneCell moves with the cell but keeps the drawing's physical size.
        const to = child(anchor, 'to') && anchor.attrs.editAs !== 'oneCell' && anchor.attrs.editAs !== 'absolute' ? marker(child(anchor, 'to')) : undefined
        const valid = (point: typeof from) => Number.isInteger(point.column) && point.column >= 0 && point.column <= 16384
          && Number.isInteger(point.row) && point.row >= 0 && point.row <= 1048576 && Number.isFinite(point.x) && Number.isFinite(point.y)
        if (!valid(from) || to && !valid(to)) { unsupported = true; continue }
        const crop = descendants(picture, 'srcRect')[0]?.attrs ?? {}
        images.push({ src, alt: descendants(picture, 'cNvPr')[0]?.attrs.descr || 'Изображение шаблона', from,
          to, width: emu(size?.attrs.cx), height: emu(size?.attrs.cy),
          rotation: finite(transform?.attrs.rot) / 60000, flipX: transform?.attrs.flipH === '1', flipY: transform?.attrs.flipV === '1',
          crop: ['l', 't', 'r', 'b'].map(key => Math.max(0, Math.min(.99, finite(crop[key]) / 100000))) })
      }
    }
  } catch { unsupported = true }
  return { images, unsupported }
}
