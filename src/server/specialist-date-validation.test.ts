import { beforeEach, expect, it, vi } from 'vitest'
import { prepareSpecialistDateChanges, confirmSpecialistDateChanges } from './specialist-date-validation'
import { loadSelectedSpecialists } from './specialists'
import type { SpecialistRecord } from '@/lib/document-specialists'

vi.mock('./specialists', () => ({ loadSelectedSpecialists: vi.fn() }))
const snapshot = { first: { id: 1, name: 'Сохранённое ФИО', stamp: 'Клеймо', certificate: '2025', certificateDate: '2025-06-01' } }
const record: SpecialistRecord = { id: 1, revision: 2, name: 'Новое ФИО', stamp: 'Новое клеймо', kind: 'inspector', methods: ['ВИК'], certificate: '2025', certificates: [
  { number: '2025', validFrom: '2025-01-01', validTo: '2025-12-31', methods: ['ВИК'] },
  { number: 'Без дат', validFrom: null, validTo: null, methods: ['ВИК'] },
] }
const document = { id: 10, type: 'system:lnkConclusionVik', title: 'Заключение', date: '2026-01-01', snapshot }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadSelectedSpecialists).mockResolvedValue(new Map([[1, record]]) as never) })

it('does not query current cards for legacy snapshots or unchanged dates', async () => {
  expect((await prepareSpecialistDateChanges({} as never, [{ ...document, snapshot: { first: { id: 1, name: 'История', certificate: '2025' } } }, { ...document, date: '2025-06-01' }])).writes).toEqual([])
  expect(loadSelectedSpecialists).not.toHaveBeenCalled()
})
it('selects on the new date while preserving saved name and stamp; requires fresh confirmation', async () => {
  const changes = await prepareSpecialistDateChanges({} as never, [document])
  expect(changes.writes[0].snapshot.first).toEqual({ ...snapshot.first, certificate: 'Без дат', certificateDate: '2026-01-01' })
  const message = await confirmSpecialistDateChanges(changes, document).catch(error => error.message)
  expect(message).toContain('2025 → № Без дат')
  const token = message.match(/specialist-confirmation:([a-f0-9]{64})/)[1]
  await expect(confirmSpecialistDateChanges(changes, document, token)).resolves.toBeUndefined()
  await expect(confirmSpecialistDateChanges({ ...changes, revisions: [[1, 3]] }, document, token)).rejects.toThrow('specialist-confirmation')
})
it('rejects unavailable certificates before writing, and batches the registry read', async () => {
  await prepareSpecialistDateChanges({} as never, Array.from({ length: 1000 }, (_, id) => ({ ...document, id })))
  expect(loadSelectedSpecialists).toHaveBeenCalledTimes(1)
  vi.mocked(loadSelectedSpecialists).mockResolvedValue(new Map([[1, { ...record, certificates: record.certificates!.slice(0, 1) }]]) as never)
  await expect(prepareSpecialistDateChanges({} as never, [document])).rejects.toThrow('нет действующего удостоверения')
})
