import { describe, expect, it } from 'vitest'

import {
  LAYERED_CONTROL_DOCUMENT_VIEWS,
  buildLayeredControlFallbackTitle,
  getRequiredLayeredControlDocumentTypes,
  isLayeredControlDocumentRequired,
  getLayeredControlWaitingLabel,
  LAYERED_CONTROL_WAITING_LABEL,
} from '@/lib/layered-control-documents'

describe('layered control document rules', () => {
  it.each(['layeredVikDocuments', 'layeredPvkDocuments'] as const)('shows a waiting note only for an assigned, not completed own primary PVK: %s', (field) => {
    for (const pvkResult of [undefined, null, '', 'ожидает НК', 'ожидает заявку', 'отменен']) {
      expect(getLayeredControlWaitingLabel({ layeredControlAssigned: true, pvkResult }, field)).toBe(LAYERED_CONTROL_WAITING_LABEL)
      expect(getLayeredControlWaitingLabel({ layeredControlAssigned: false, pvkResult }, field)).toBe('')
    }
    for (const pvkResult of ['годен', 'ремонт', 'вырез', 'да', 'проведено', 'годен (отменен)', 'проведено (отменен)', ' ГОДЕН ']) {
      expect(getLayeredControlWaitingLabel({ layeredControlAssigned: true, pvkResult }, field)).toBe('')
    }
    expect(getLayeredControlWaitingLabel({ layeredControlAssigned: true }, 'pvkConclusion')).toBe('')
  })

  it('does not replace a partial historical set with waiting text', () => {
    const row = { layeredControlAssigned: true, layeredVikEdgesDocument: 'Историческое заключение' }
    expect(getLayeredControlWaitingLabel(row, 'layeredVikDocuments')).toBe('')
    expect(getLayeredControlWaitingLabel(row, 'layeredPvkDocuments')).toBe(LAYERED_CONTROL_WAITING_LABEL)
  })

  it('creates the four conclusions only after explicit assignment and our primary PVK result', () => {
    expect(getRequiredLayeredControlDocumentTypes({
      connectionType: 'У17',
      weldDate: '2026-09-01',
      hasVik: 'да',
      hasPvk: 'да',
      layeredControlAssigned: true,
      pvkResult: 'годен',
      pstoRequired: 'да',
      weldControlPercent: 0,
    })).toEqual([
      'layeredVikEdges',
      'layeredVikLayers',
      'layeredPvkEdges',
      'layeredPvkLayers',
    ])
  })

  it.each([
    [{ connectionType: 'С17', weldDate: '2026-09-01', hasVik: 'да' }, false],
    [{ connectionType: 'У17', weldDate: null, hasVik: 'да' }, false],
    [{ connectionType: 'У17', weldDate: '2026-09-01', hasVik: 'отменен' }, false],
    [{ connectionType: 'У17', weldDate: '2026-09-01', hasVik: 'дополнительный' }, false],
    [{ connectionType: 'У17', weldDate: '2026-09-01', hasPvk: 'да', pvkResult: 'годен' }, false],
    [{ connectionType: 'У17', weldDate: '2026-09-01', hasPvk: 'да', layeredControlAssigned: true }, false],
    [{ connectionType: 'У17', weldDate: '2026-09-01', hasPvk: 'да', layeredControlAssigned: true, pvkResult: 'годен' }, true],
  ] as const)('applies the U-joint/date/assignment gate to %o', (row, expected) => {
    expect(isLayeredControlDocumentRequired(row, 'layeredVikEdges')).toBe(expected)
  })

  it('uses the approved full-date fallback names before a constructor is configured', () => {
    expect(buildLayeredControlFallbackTitle('layeredVikEdges', {
      id: 7,
      joint: 'F2',
      weldDate: '2026-09-01',
    })).toBe('ВИК - кромки - F2 - 01.09.2026')
    expect(buildLayeredControlFallbackTitle('layeredPvkLayers', {
      id: 8,
      joint: 'S4',
      weldDate: '2026-09-02',
    })).toBe('ПВК - слои - S4 - 02.09.2026')
  })

  it('keeps document history grouped into two final tabs', () => {
    expect(LAYERED_CONTROL_DOCUMENT_VIEWS).toEqual([
      {
        id: 'layeredVik',
        label: 'Послойный ВИК',
        types: ['layeredVikEdges', 'layeredVikLayers'],
      },
      {
        id: 'layeredPvk',
        label: 'Послойный ПВК',
        types: ['layeredPvkEdges', 'layeredPvkLayers'],
      },
    ])
  })
})
