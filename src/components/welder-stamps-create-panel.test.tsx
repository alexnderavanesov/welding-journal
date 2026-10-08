import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WelderStampsCreatePanel } from './welder-stamps-create-panel'
import { createEmptyWelderStampDraft } from '@/lib/welder-stamp-registry'
import { createEmptyDlsPermit, createEmptyNaksPermit } from '@/lib/welder-stamp-permits'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

function fixture(): WelderStampRecord {
  const permit = { ...createEmptyNaksPermit(), id: 'keep-naks', weldType: 'РАД', materialGroups: 'М01',
    diameterFrom: '1', diameterTo: '500', thicknessFrom: '1', thicknessTo: '20',
    validFrom: '2026-01-01', validTo: '2026-12-31', note: 'Не менять' }
  return { ...createEmptyWelderStampDraft(), id: 41, naksStamp: 'AUD1', naksPermits: [permit],
    dlsPermits: [{ ...createEmptyDlsPermit(), ...permit, id: 'keep-dls', number: 'ДЛС-41' }] }
}

function Harness({ initial, onSave }: { initial: WelderStampRecord; onSave: (value: WelderStampRecord) => boolean }) {
  const [draft, setDraft] = useState(initial)
  return <WelderStampsCreatePanel draft={draft} editingId={draft.id} records={[initial]}
    onDraftChange={(field, value) => setDraft(previous => ({ ...previous, [field]: value }))}
    onReset={() => setDraft(initial)} onSave={() => onSave(draft)} />
}

beforeEach(() => localStorage.clear())

describe('multi-material permit editor', () => {
  it('keeps three groups and both methods in one NAKS/DLS without changing IDs, dates or notes', () => {
    const initial = fixture(), save = vi.fn((_value: WelderStampRecord) => true)
    const { container } = render(<Harness initial={initial} onSave={save} />)
    for (const id of ['keep-naks', 'keep-dls']) {
      const editor = within(container.querySelector(`[data-permit-editor-id="${id}"]`) as HTMLElement)
      for (const value of ['М05', 'М11', 'РД']) fireEvent.click(editor.getByRole('button', { name: value }))
      fireEvent.click(editor.getByRole('button', { name: 'М01' }))
      fireEvent.click(editor.getByRole('button', { name: 'М01' }))
      for (const value of ['М01', 'М05', 'М11', 'РАД', 'РД']) {
        expect(editor.getByRole('button', { name: value })).toHaveAttribute('aria-pressed', 'true')
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить клеймо' }))
    expect(save).toHaveBeenCalledOnce()
    const saved = save.mock.calls[0][0]
    for (const [actual, previous] of [[saved.naksPermits[0], initial.naksPermits[0]], [saved.dlsPermits[0], initial.dlsPermits[0]]]) {
      expect(actual).toEqual({ ...previous, materialGroups: expect.any(String), weldType: 'РАД, РД' })
      expect(actual.materialGroups.split(', ').sort()).toEqual(['М01', 'М05', 'М11'])
    }
    expect(initial.naksPermits[0].materialGroups).toBe('М01')
  })

  it('preserves and displays stored codes absent from settings, without Latin/Cyrillic substitution', () => {
    const initial = fixture(), save = vi.fn((_value: WelderStampRecord) => true)
    initial.naksPermits[0] = { ...initial.naksPermits[0], materialGroups: 'M01, М99', weldType: 'РАД, ОСОБЫЙ' }
    initial.dlsPermits = []
    const { container } = render(<Harness initial={initial} onSave={save} />)
    const editor = within(container.querySelector('[data-permit-editor-id="keep-naks"]') as HTMLElement)
    for (const value of ['M01', 'М99', 'ОСОБЫЙ']) {
      expect(editor.getByRole('button', { name: value })).toHaveAttribute('aria-pressed', 'true')
    }
    fireEvent.click(editor.getByRole('button', { name: 'М05' }))
    fireEvent.click(editor.getByRole('button', { name: 'РД' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить клеймо' }))
    expect(save).toHaveBeenCalledOnce()
    const permit = save.mock.calls[0][0].naksPermits[0]
    expect(permit.materialGroups).toBe('M01, М99, М05')
    expect(permit.weldType).toBe('РАД, ОСОБЫЙ, РД')
    expect(permit.id).toBe('keep-naks')
  })
})
