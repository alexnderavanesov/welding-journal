import { describe, expect, it } from 'vitest'

import { applyGeneratedDocumentFields } from '@/server/generated-document-row-fields'

describe('generated document row fields', () => {
  it('attaches each document type independently to the same weld', () => {
    expect(
      applyGeneratedDocumentFields(
        [{
          id: 10,
          joint: 'S1',
          rkRequest: 'Заявка НК №7',
          rkRequestDate: '2026-08-10',
        }],
        [
          { weldJointId: 10, documentId: 1, type: 'weldingJournal', title: 'ЖСР №1' },
          { weldJointId: 10, documentId: 2, type: 'checklist', title: 'Чек-лист №7' },
          { weldJointId: 10, documentId: 3, type: 'zni', title: 'ЗНИ №4' },
          {
            weldJointId: 10,
            documentId: 4,
            type: 'system:lnkRequest',
            title: 'Заявка НК №7',
            periodFrom: '2026-08-10',
          },
        ],
      ),
    ).toEqual([
      {
        id: 10,
        joint: 'S1',
        rkRequest: 'Заявка НК №7',
        rkRequestDate: '2026-08-10',
        jsrDocument: 'ЖСР №1',
        jsrDocumentId: 1,
        checklistDocument: 'Чек-лист №7',
        checklistDocumentId: 2,
        zniDocument: 'ЗНИ №4',
        zniDocumentId: 3,
        systemDocumentIds: { rkRequest: 4 },
      },
    ])
  })
})
