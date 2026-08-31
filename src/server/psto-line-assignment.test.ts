import { describe, expect, it } from 'vitest'

import { normalizePstoLineAssignmentPayload } from '@/server/psto-line-assignment'

describe('PSTO line assignment payload', () => {
  it('normalizes the full project/subtitle/line identity and removal decisions', () => {
    expect(normalizePstoLineAssignmentPayload({
      identity: { projectTitle: ' Проект ', subtitleCode: ' 400 ', line: ' L-1 ' },
      action: 'remove',
      activationDecisions: [
        {
          rowId: 3,
          disposition: 'movePrimaryToBeforeHeatTreatment',
          methodCodes: [' вик ', 'РК', 'ВИК', 'ТВМТ'] as never,
        },
        {
          rowId: 4,
          disposition: 'keepPrimary',
          methodCodes: ['ПВК'],
        },
      ],
      decisions: [
        { rowId: 1, disposition: 'keepPrimary' },
        { rowId: 2, disposition: 'promoteBeforeHeatTreatment' },
        { rowId: -1, disposition: 'keepPrimary' },
      ],
    })).toEqual({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
      action: 'remove',
      cancellationDate: '',
      cancellationBasis: '',
      activationDecisions: [{
        rowId: 3,
        disposition: 'movePrimaryToBeforeHeatTreatment',
        methodCodes: ['ВИК', 'РК'],
      }, {
        rowId: 4,
        disposition: 'keepPrimary',
        methodCodes: ['ПВК'],
      }],
      decisions: [
        { rowId: 1, disposition: 'keepPrimary' },
        { rowId: 2, disposition: 'promoteBeforeHeatTreatment' },
      ],
    })
  })

  it('rejects an empty line and an unknown action', () => {
    expect(() => normalizePstoLineAssignmentPayload({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: '' },
      action: 'assign',
    })).toThrow('укажите линию')

    expect(() => normalizePstoLineAssignmentPayload({
      identity: { projectTitle: 'Проект', subtitleCode: '400', line: 'L-1' },
      action: 'other' as 'assign',
    })).toThrow('Неизвестное действие')
  })
})
