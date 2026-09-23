import { expect, test } from '@playwright/test'
import { inArray } from 'drizzle-orm'
import { withE2eDatabase } from '../database'
import { requireDb } from '@/db'
import { weldJoints } from '@/db/schema'
import { changeSystemDocumentDate } from '@/server/system-document-date-workflow'
import { buildSystemDocumentSummaries } from '@/lib/system-document-types'
import { syncSystemDocumentsForWeldChangesInTransaction, upsertSourcedSystemDocumentInTransaction } from '@/server/system-document-index'

for (const sourced of [false, true]) test(`общая дата ТВМТ (${sourced ? 'цикл' : 'исторический документ'}): старое нарушение другого F611 не разрешает новое, отказ ничего не сохраняет`, async () => {
  const title = 'E2E общее ТВМТ одинаковых номеров'
  const ids: number[] = []
  try {
    await withE2eDatabase(async (client) => {
      const result = await client.query<{ id: number }>(`insert into weld_joints (
        project_title, subtitle_code, line, joint, weld_date, psto_required, has_vik,
        pre_heat_treatment_lnk_exempt, psto_request, psto_request_date, psto_date, psto_result,
        tvmt_request, tvmt_request_date, tvmt_result, tvmt_conclusion, tvmt_conclusion_date,
        vik_request, vik_request_date, vik_result, vik_conclusion, vik_conclusion_date
      ) select 'E2E chronology isolation', 'P', 'L' || n, 'F611', '2026-03-01', 'да', 'да',
        true, 'P', '2026-03-03', '2026-03-04', 'проведено', 'T', '2026-03-04',
        case when n = 1 then 'не годен' else 'годен' end, $1, '2026-03-10',
        'V', '2026-03-02', 'годен', 'V-result', '2026-03-15'
      from generate_series(1, 2) n returning id`, [title])
      ids.push(...result.rows.map((row) => row.id))
      await client.query(`insert into psto_repeat_cycles (
        weld_joint_id, sequence, psto_request, psto_request_date, psto_date, psto_result,
        tvmt_request, tvmt_request_date, tvmt_result, tvmt_conclusion, tvmt_conclusion_date
      ) values ($1, 2, 'P-2', '2026-03-20', '2026-03-20', 'проведено',
        'T-2', '2026-03-20', 'годен', 'E2E ТВМТ повтор', '2026-03-20')`, [ids[0]])
    })
    await requireDb().transaction(async (tx) => {
      const rows = await tx.select().from(weldJoints).where(inArray(weldJoints.id, ids))
      await syncSystemDocumentsForWeldChangesInTransaction(tx, rows, new Map())
      if (sourced) {
        // Normal PSTO workflows explicitly attach cycle positions after the
        // legacy primary-index sync; raw fixture inserts alone do not do this.
        const summary = buildSystemDocumentSummaries(rows, 'lnkConclusion').find((item) => item.title === title)!
        await upsertSourcedSystemDocumentInTransaction({
          tx, summary: { ...summary, sourceKind: 'pstoCycle', cycleSequences: [1] },
          sourcePositions: rows.map((row) => ({ kind: 'pstoCycle', weldJointId: row.id, relationId: row.id, sequence: 1, methodCode: 'ТВМТ' })),
        })
      }
    })
    const before = await readState()
    expect(before.documents).toHaveLength(1)
    expect(before.assignments).toHaveLength(2)
    const expectedVersions = await withE2eDatabase(async (client) => (
      await client.query<{ id: number; version: string }>(
        'select id, xmin::text as version from weld_joints where id = any($1::int[]) order by id', [ids],
      )
    ).rows)
    await expect(changeSystemDocumentDate({ data: {
      reference: { type: 'lnkConclusion', methodCode: 'ТВМТ', title, date: '2026-03-10', ...(sourced ? { sourceKind: 'pstoCycle' as const, cycleSequences: [1] } : {}) },
      nextDate: '2026-03-20', expectedVersions,
    } })).rejects.toThrow('раньше ТВМТ')
    expect(await readState()).toEqual(before)
  } finally {
    if (ids.length) await withE2eDatabase(async (client) => {
      await client.query('delete from weld_joints where id = any($1::int[])', [ids])
      await client.query('delete from generated_documents where title = any($1::text[])', [[title, 'E2E ТВМТ повтор']])
    })
  }

  async function readState() {
    return withE2eDatabase(async (client) => ({
      welds: (await client.query('select * from weld_joints where id = any($1::int[]) order by id', [ids])).rows,
      cycles: (await client.query('select * from psto_repeat_cycles where weld_joint_id = any($1::int[]) order by id', [ids])).rows,
      documents: (await client.query('select * from generated_documents where title = $1 order by id', [title])).rows,
      assignments: (await client.query(`select a.* from generated_document_weld_joints a
        join generated_documents d on d.id = a.document_id where d.title = $1 order by a.weld_joint_id`, [title])).rows,
    }))
  }
})
