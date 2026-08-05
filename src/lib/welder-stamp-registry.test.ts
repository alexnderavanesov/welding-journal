import { describe, expect, it } from 'vitest'
import {
  createEmptyWelderStampDraft,
  prepareWelderStampSave,
  setWelderStampRecordArchived,
} from './welder-stamp-registry'

describe('welder stamp registry archive date', () => {
  it('sets an archive date when a stamp is moved to the archive', () => {
    const record = {
      ...createEmptyWelderStampDraft(),
      id: 1,
      internalStamp: '1111',
    }

    const [archivedRecord] = setWelderStampRecordArchived([record], record.id, true)

    expect(archivedRecord.archived).toBe(true)
    expect(archivedRecord.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('requires an archive date when an archived stamp is saved', () => {
    const record = {
      ...createEmptyWelderStampDraft(),
      id: 1,
      internalStamp: '1111',
      archived: true,
      archivedAt: '',
    }

    expect(prepareWelderStampSave([record], record, record.id)).toEqual({
      ok: false,
      message: 'Укажите дату архивации клейма',
    })
  })

  it('preserves a manually corrected archive date', () => {
    const record = {
      ...createEmptyWelderStampDraft(),
      id: 1,
      internalStamp: '1111',
      archived: true,
      archivedAt: '2026-07-15',
    }

    const result = prepareWelderStampSave([record], record, record.id)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nextRecords[0]?.archivedAt).toBe('2026-07-15')
  })
})
