import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildSpecialistParticipant, buildWelderParticipants, getParticipantTemplateIssues, sortUniqueParticipants } from './document-template-participants'
import { createWeldingJournalBlobFromTemplate } from './document-template-workbook'
import { normalizeDocumentTemplateConstructorConfig, type StoredDocumentTemplate } from './document-template-model'

const registry = [{ id: 1, welderName: 'Иванов', naksStamp: 'A1', internalStamp: '11' }, { id: 2, welderName: 'Иванов', naksStamp: 'A2', internalStamp: '12' }]
const inspector = (certificate = 'OLD') => buildSpecialistParticipant('inspector', { id: 3, name: 'Петров', certificate })!
const read = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
function template(): StoredDocumentTemplate {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Объект', ''], ['№', 'ФИО', 'Специальность', 'Разряд вручную', 'Удостоверение', 'Клеймо'],
    ['', '', '', '', '', ''], ['Подпись руководителя'],
  ]), 'Список')
  const fileData = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return { id: 'custom1', fileName: 'people.xlsx', fileType: 'xlsx', fileSize: fileData.byteLength, fileData,
    uploadedAt: '', fields: [], markerCount: 0, locations: [], warnings: [], constructorConfig: {
      version: 1, sheetName: 'Список', repeatRow: 3, repeatMode: 'participants', participantKinds: ['welder', 'thermist', 'inspector'],
      bindings: [{ cell: 'B1', mode: 'summary', field: 'projectTitle' }, { cell: 'A3', mode: 'row', field: '__index' },
        { cell: 'B3', mode: 'row', field: '__participantName' }, { cell: 'C3', mode: 'row', field: '__participantKind' },
        { cell: 'E3', mode: 'row', field: '__participantCertificate' }, { cell: 'F3', mode: 'row', field: '__participantStamp' }],
    } }
}

describe('work participant templates', () => {
  it('deduplicates registry aliases, keeps namesakes and retains an unknown official stamp for manual completion', () => {
    const people = buildWelderParticipants(['a1', '11', ' A1 ', '12', 'MISSING'], registry)
    expect(people).toHaveLength(3)
    expect(people[0]).toMatchObject({ name: 'Иванов', stamp: 'A1', internalStamp: '11', certificate: '' })
    expect(people[1].key).not.toBe(people[0].key)
    expect(people[2]).toMatchObject({ name: '', stamp: 'MISSING' })
  })
  it('keeps historical certificate variants, orders categories and ignores empty assignments', () => {
    const thermist = buildSpecialistParticipant('thermist', { id: 7, name: 'Термист', certificate: 'T' })!
    const people = sortUniqueParticipants([inspector(), thermist, inspector('NEW'), inspector(), ...buildWelderParticipants(['11'], registry)])
    expect(people.map(person => person.kind)).toEqual(['welder', 'thermist', 'inspector', 'inspector'])
    expect(people.filter(person => person.kind === 'inspector')).toHaveLength(2)
    expect(buildSpecialistParticipant('inspector', null)).toBeNull()
  })
  it('preserves the mode/categories on reload and rejects ambiguous row fields or an empty category choice', () => {
    const config = template().constructorConfig!
    expect(normalizeDocumentTemplateConstructorConfig(config)).toMatchObject({ repeatMode: 'participants', participantKinds: ['welder', 'thermist', 'inspector'] })
    expect(getParticipantTemplateIssues({ ...config, participantKinds: [] })).toHaveLength(1)
    expect(getParticipantTemplateIssues({ ...config, repeatMode: 'rows' }).length).toBeGreaterThan(0)
    expect(getParticipantTemplateIssues({ ...config, bindings: [{ cell: 'A3', mode: 'row', field: 'joint' }] })[0].message).toContain('Данные стыков')
  })
  it('exports one row per participant, document summaries, blank manual fields, numbering and shifted signatures', async () => {
    const input = template(), before = input.fileData.slice(0)
    const participants = sortUniqueParticipants([...buildWelderParticipants(['11'], registry), inspector()])
    const blob = await createWeldingJournalBlobFromTemplate(input, [{ id: 1, joint: 'F1', projectTitle: 'Проект' }], { participants })
    const sheet = XLSX.read(await read(blob), { type: 'array' }).Sheets['Список']
    expect(sheet.B1.v).toBe('Проект')
    expect([sheet.A3.v, sheet.B3.v, sheet.C3.v, sheet.E3.v, sheet.F3.v]).toEqual([1, 'Иванов', 'Сварщик', '', 'A1'])
    expect([sheet.A4.v, sheet.B4.v, sheet.C4.v, sheet.E4.v]).toEqual([2, 'Петров', 'Дефектоскопист', 'OLD'])
    expect(sheet.D3?.v ?? '').toBe(''); expect(sheet.D4?.v ?? '').toBe('')
    expect(sheet.A5.v).toBe('Подпись руководителя'); expect(input.fileData).toEqual(before)
    input.constructorConfig!.participantKinds = ['inspector']
    const filtered = XLSX.read(await read(await createWeldingJournalBlobFromTemplate(input, [], { participants })), { type: 'array' }).Sheets['Список']
    expect(filtered.B3.v).toBe('Петров'); expect(filtered.A4.v).toBe('Подпись руководителя')
    const empty = XLSX.read(await read(await createWeldingJournalBlobFromTemplate(input, [], { participants: [] })), { type: 'array' }).Sheets['Список']
    expect(empty.A3?.v ?? '').toBe(''); expect(empty.B3?.v ?? '').toBe(''); expect(empty.A4.v).toBe('Подпись руководителя')
  })
  it('exports participant text as literal values and removes inherited formulas from assigned cells', async () => {
    const input = template()
    const source = XLSX.read(input.fileData, { type: 'array' })
    source.Sheets.Список.B3 = { t: 's', v: 'Old name', f: 'A1' }
    source.Sheets.Список.E3 = { t: 's', v: 'Old certificate', f: 'A1' }
    input.fileData = XLSX.write(source, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const participant = buildSpecialistParticipant('inspector', {
      id: 9, name: '=HYPERLINK("https://example.invalid","Name")', certificate: '+SUM(1,2)',
    })!
    const sheet = XLSX.read(await read(await createWeldingJournalBlobFromTemplate(input, [], { participants: [participant] })),
      { type: 'array' }).Sheets.Список
    expect(sheet.B3).toMatchObject({ t: 's', v: participant.name })
    expect(sheet.E3).toMatchObject({ t: 's', v: participant.certificate })
    expect(sheet.B3.f).toBeUndefined(); expect(sheet.E3.f).toBeUndefined()
  })
})
