import { describe, expect, it } from 'vitest'

import {
  LAYERED_CONTROL_DOCUMENT_VIEWS,
  buildLayeredControlFallbackTitle,
  getRequiredLayeredControlDocumentTypes,
  isLayeredControlDocumentRequired,
} from '@/lib/layered-control-documents'

describe('layered control document rules', () => {
  it('creates two VIK and two PVK conclusions only for a welded U-joint with enabled assignments', () => {
    expect(getRequiredLayeredControlDocumentTypes({
      connectionType: 'У17',
      weldDate: '2026-09-01',
      hasVik: 'да',
      hasPvk: 'дополнительный',
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
    [{ connectionType: 'У17', weldDate: '2026-09-01', hasVik: 'дополнительный' }, true],
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
