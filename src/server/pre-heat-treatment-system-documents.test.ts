import { beforeEach, expect, it, vi } from 'vitest'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { PreHeatTreatmentControlRecord } from '@/lib/lnk-control-stage'
import { indexPreHeatTreatmentDocumentControls, syncPreHeatTreatmentDocumentsInTransaction } from './pre-heat-treatment-system-documents'

const write = vi.hoisted(() => vi.fn())
vi.mock('@/server/system-document-index', () => ({ upsertSourcedSystemDocumentsInTransaction: write }))
beforeEach(() => { write.mockClear() })

it('indexes all 200000 positions with constant reads per position, retaining the last exact document', () => {
  let reads = 0
  const controls = Array.from({ length: 200_000 }, (_, i) => ({ id: i + 1, weldJointId: i + 1, method: 'ВИК',
    get requestName() { reads++; return `R${i + 1}` }, requestDate: '2026-09-01',
    get conclusionName() { reads++; return `C${i + 1}` }, conclusionDate: '2026-09-02',
  })) as PreHeatTreatmentControlRecord[]
  const index = indexPreHeatTreatmentDocumentControls(controls)
  expect(index.requests.size).toBe(200_000)
  expect(index.conclusions.get(JSON.stringify(['C200000', '2026-09-02', 'ВИК']))).toEqual([controls.at(-1)])
  expect(reads).toBe(400_000)
})

it.each([24, 2048])('matches %i distinct pre-TO documents without rereading every control for each document', async count => {
  let reads = 0
  const rows: WeldRow[] = Array.from({ length: count }, (_, i) => ({ id: i + 1, joint: `S${i + 1}` }))
  const controls = rows.map(row => ({ id: row.id, weldJointId: row.id, method: 'ВИК', result: 'годен',
    get requestName() { reads++; return `R${row.id}` }, requestDate: '2026-09-01',
    get conclusionName() { reads++; return `C${row.id}` }, conclusionDate: '2026-09-02',
  })) as PreHeatTreatmentControlRecord[]
  await syncPreHeatTreatmentDocumentsInTransaction({} as never, rows, controls)
  expect(write).toHaveBeenCalledTimes(1)
  const { documents } = write.mock.calls[0][0]
  expect(documents).toHaveLength(count * 2)
  expect(documents.find((d: { summary: { title: string } }) => d.summary.title === `C${count}`).sourcePositions)
    .toEqual([{ kind: 'beforeHeatTreatment', weldJointId: count, relationId: count, methodCode: 'ВИК' }])
  expect(reads).toBeLessThanOrEqual(count * 16)
})

it('keeps a shared request across methods, but separates conclusions by method and exact date', async () => {
  const rows = [{ id: 1, joint: 'S1' }, { id: 2, joint: 'S2' }, { id: 3, joint: 'S3' }]
  const controls = [
    { id: 10, weldJointId: 1, method: 'ВИК', requestDate: '2026-09-01', conclusionDate: '2026-09-02' },
    { id: 11, weldJointId: 1, method: 'РК', requestDate: '2026-09-01', conclusionDate: '2026-09-02' },
    { id: 12, weldJointId: 2, method: 'РК', requestDate: '2026-09-01', conclusionDate: '2026-09-03' },
    { id: 13, weldJointId: 3, method: 'РК', requestDate: '2026-09-04', conclusionDate: '2026-09-05' },
  ].map(control => ({ ...control, requestName: ' Общее имя ', conclusionName: ' Заключение ', result: 'годен' })) as PreHeatTreatmentControlRecord[]
  await syncPreHeatTreatmentDocumentsInTransaction({} as never, rows, controls)
  const { documents } = write.mock.calls[0][0]
  const positions = (type: string, date: string, method?: string) => documents
    .find((d: { summary: { type: string; date: string; methodCode?: string } }) =>
      d.summary.type === type && d.summary.date === date && (!method || d.summary.methodCode === method))
    .sourcePositions.map((p: { relationId: number }) => p.relationId)
  expect(positions('lnkRequest', '2026-09-01')).toEqual([10, 11, 12])
  expect(positions('lnkRequest', '2026-09-04')).toEqual([13])
  expect(positions('lnkConclusion', '2026-09-02', 'ВИК')).toEqual([10])
  expect(positions('lnkConclusion', '2026-09-02', 'РК')).toEqual([11])
  expect(positions('lnkConclusion', '2026-09-03', 'РК')).toEqual([12])
})
