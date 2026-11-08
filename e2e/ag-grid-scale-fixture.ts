import { withE2eDatabase } from './database'
import { withLineProgramFixture } from './line-program-fixtures'
import { SYSTEM_DOCUMENT_TYPES } from '../src/lib/system-document-types'
import { loadSystemDocumentSummaries } from '../src/server/system-document-index'

export const AG_GRID_SCALE_PROJECT = 'E2E AG Grid scale 2026-11-07'

const heavyLines = ['AGS-HEAVY-10000', 'AGS-HEAVY-4000-A', 'AGS-HEAVY-4000-B'] as const
const documentPrefix = 'AGS-'
const stampCount = 2000
const jointName = (ordinal: number) => `${(ordinal - 1) % 100 >= 80 ? 'ОП' : 'F'}${String(ordinal).padStart(12, '0')}`
const isometryName = (ordinal: number) => `AGS-ISO-${String(ordinal).padStart(12, '0')}`

function equalCount(actual: number, expected: number, label: string) {
  if (actual !== expected) throw new Error(`AG Grid scale fixture: ${label}: expected ${expected}, received ${actual}`)
}

/** Seed only the runner-owned disposable database, before opening any browser.
 * No source data, warm calculation, application mutation or cleanup is hidden
 * here. The runner owns its one database and drops it after its entire series.
 * Historical document positions refer to real control/cycle rows; primary
 * cycle positions use the weld ID, exactly as the application does. */
export async function seedAgGridScaleFixture(count: 50000 | 250000) {
  if (count !== 50000 && count !== 250000) throw new Error('Expected exactly 50000 or 250000 fixture joints')
  const repeatJoints = count / 20
  const lineCount = 3 + (count - 18000) / 100
  await withE2eDatabase(async db => {
    const { rows: [initial] } = await db.query(`select
      (select count(*)::int from weld_joints) joints,
      (select count(*)::int from weld_joints where project_title='E2E проект' and joint='F1' and line='E2E-L1') setup_joints,
      (select count(*)::int from generated_documents) documents,
      (select count(*)::int from line_programs where project_title=$1) own_lines,
      (select count(*)::int from welder_stamps where naks_stamp ~ '^[QR][0-9]{3}$') stamp_collisions`, [AG_GRID_SCALE_PROJECT])
    equalCount(initial.joints, 1, 'initial global-setup joint count')
    equalCount(initial.setup_joints, 1, 'known global-setup identity')
    equalCount(initial.documents, 0, 'initial documents')
    equalCount(initial.own_lines, 0, 'existing fixture lines')
    equalCount(initial.stamp_collisions, 0, 'existing fixture stamps')
  })
  // Initialize the application's registry markers while the database contains
  // only the setup joint. Otherwise the first UI read would rebuild our already
  // materialized history rather than measure ordinary registry browsing.
  for (const type of SYSTEM_DOCUMENT_TYPES) await loadSystemDocumentSummaries(type)

  const manifest = await withLineProgramFixture(async db => {
    // Multiples of 100 preserve document sizes 2/10/20 at every family/line
    // boundary. 20% supports have UZK; ordinary S/U joints have RK.
    await db.query(`create temporary table ag_scale_input on commit drop as
      with source as (
        select n ordinal, (n-1)%100>=80 is_support,
          case when n<=10000 then 0 when n<=14000 then 1 when n<=18000 then 2 else 3+(n-18001)/100 end line_number,
          case when n<=10000 then (n-1)%200
            when n<=14000 then (n-10001)/400
            when n<=16800 then 900
            when n<=18000 then 901+(n-16801)%199
            else (n-18001)%2000 end stamp_number
        from generate_series(1,$1::int) n
      ) select *, case line_number when 0 then $2 when 1 then $3 when 2 then $4
          else 'AGS-L-'||lpad((line_number-2)::text,5,'0') end line,
        case when line_number<3 then 'AGS-HEAVY' else 'AGS-CODE-'||lpad((line_number%25)::text,2,'0') end subtitle,
        case when stamp_number<1000 then 'Q' else 'R' end||lpad((stamp_number%1000)::text,3,'0') stamp
      from source`, [count, ...heavyLines])
    await db.query('create unique index on ag_scale_input(ordinal)')
    await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,
        weld_control_percent,pvk_control_percent,psto_assignment,created_at,updated_at)
      select distinct $1,subtitle,line,'II','Б(а)',100,10,'assigned',timestamptz '2026-08-01T09:00:00Z',timestamptz '2026-08-01T09:00:00Z'
      from ag_scale_input order by subtitle,line`, [AG_GRID_SCALE_PROJECT])
    await db.query(`insert into welder_stamps(naks_stamp,internal_stamp,welder_name,weld_type,material_groups,
        diameter_from,diameter_to,thickness_from,thickness_to,valid_from,valid_to,naks_permits,dls_permits)
      select case when n<1000 then 'Q' else 'R' end||lpad((n%1000)::text,3,'0'),
        'AGS-I-'||lpad(n::text,4,'0'),'AGS сварщик '||lpad(n::text,4,'0'),
        'РД','М01','10','1000','1','50','2026-01-01','2027-12-31','[]','[]'
      from generate_series(0,$1::int-1) n order by n`, [stampCount])
    await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,isometry,spool,
        weld_date,connection_type,officiality,revision_actuality,category,group_name,weld_control_percent,pvk_control_percent,
        welding_method,material_group,d1,d2,t1,t2,weld_length,wdi,
        stamp_1_k,stamp_1_z,stamp_1_k_fact,stamp_1_z_fact,
        has_vik,vik_control_basis,vik_request,vik_request_date,vik_result,vik_conclusion,vik_conclusion_date,
        has_rk,rk_control_basis,rk_request,rk_request_date,rk_result,rk_conclusion,rk_conclusion_date,
        has_uzk,uzk_control_basis,uzk_request,uzk_request_date,uzk_result,uzk_conclusion,uzk_conclusion_date,
        psto_required,psto_control_basis,pre_heat_treatment_required,psto_request,psto_request_date,psto_result,psto_date,heat_treatment_diagram,
        tvmt_request,tvmt_request_date,tvmt_result,tvmt_conclusion,tvmt_conclusion_date,
        welding_journal_note,lnk_note,created_at,welding_updated_at,lnk_created_at,lnk_updated_at,psto_created_at,psto_updated_at)
      select p.id,$1,i.subtitle,i.line,case when i.is_support then 'ОП' else 'F' end||lpad(i.ordinal::text,12,'0'),
        'AGS-ISO-'||lpad(i.ordinal::text,12,'0'),'AGS-SPOOL-'||((i.ordinal-1)/5+1),
        date '2026-08-01'+(i.ordinal%20),case when i.is_support then 'Т1' when i.ordinal%7=0 then 'У19' else 'С17' end,
        'действующий','актуальная','II','Б(а)',100,10,'РД','М01',108,108,4,4,
        case when i.is_support then 600.123 end,case when not i.is_support then 0.42 end,
        i.stamp,case when not i.is_support then i.stamp end,i.stamp,case when not i.is_support then i.stamp end,
        'да','проект','AGS-NK-'||((i.ordinal-1)/2+1),'2026-09-07','годен','AGS-VIK-'||((i.ordinal-1)/2+1),'2026-09-08',
        case when not i.is_support then 'да' else 'нет' end,'проект',
        case when not i.is_support then 'AGS-NK-'||((i.ordinal-1)/2+1) end,case when not i.is_support then date '2026-09-07' end,
        case when not i.is_support then 'годен' end,case when not i.is_support then 'AGS-RK-'||((i.ordinal-1)/2+1) end,case when not i.is_support then date '2026-09-08' end,
        case when i.is_support then 'да' else 'нет' end,'проект',
        case when i.is_support then 'AGS-NK-'||((i.ordinal-1)/2+1) end,case when i.is_support then date '2026-09-07' end,
        case when i.is_support then 'годен' end,case when i.is_support then 'AGS-UZK-'||((i.ordinal-1)/2+1) end,case when i.is_support then date '2026-09-08' end,
        'да','проект',true,'AGS-PSTOR-'||((i.ordinal-1)/20+1),'2026-09-04','проведено','2026-09-05','AGS-PSTOC-'||((i.ordinal-1)/20+1),
        'AGS-TVMTR-'||((i.ordinal-1)/20+1),'2026-09-05',case when i.ordinal<=$2 then 'не годен' else 'годен' end,
        'AGS-TVMTC-'||((i.ordinal-1)/20+1),'2026-09-06',
        case when i.ordinal%7=0 then repeat('Длинное примечание: проверка переноса текста, номера чертежа и чтения строки. ',8)||i.ordinal else 'AGS факт '||i.ordinal end,
        case when i.ordinal%11=0 then repeat('Сохранённая история контроля с подробным пояснением. ',6) else '' end,
        '2026-10-31T21:01:02Z','2026-11-02T09:10:11Z','2026-10-31T21:01:02Z','2026-11-02T09:10:11Z','2026-10-31T21:01:02Z','2026-11-02T09:10:11Z'
      from ag_scale_input i join line_programs p on p.project_title=$1 and p.subtitle_code=i.subtitle and p.line=i.line
      order by i.ordinal`, [AG_GRID_SCALE_PROJECT, repeatJoints])
    await db.query(`create temporary table ag_scale_rows on commit drop as
      select w.id,i.ordinal,i.line,i.subtitle,i.stamp,i.is_support,w.weld_date
      from ag_scale_input i join weld_joints w on w.project_title=$1 and w.isometry='AGS-ISO-'||lpad(i.ordinal::text,12,'0')`, [AG_GRID_SCALE_PROJECT])
    await db.query('create unique index on ag_scale_rows(id)')
    await db.query('create unique index on ag_scale_rows(ordinal)')
    await db.query('analyze ag_scale_rows')
    await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id)
      select id,'primary',id from ag_scale_rows order by id`)
    await db.query(`insert into pre_heat_treatment_controls(weld_joint_id,method,request_name,request_date,conclusion_name,conclusion_date,result)
      select r.id,m,'AGS-PRE-NK-'||((r.ordinal-1)/10+1),'2026-08-28',
        'AGS-PRE-'||m||'-'||((r.ordinal-1)/10+1),'2026-08-29','годен'
      from ag_scale_rows r cross join lateral unnest(array['ВИК',case when r.is_support then 'УЗК' else 'РК' end]) m
      order by r.ordinal,m`)
    await db.query(`insert into psto_repeat_cycles(weld_joint_id,sequence,psto_request,psto_request_date,psto_date,heat_treatment_diagram,psto_result,
        tvmt_request,tvmt_request_date,tvmt_conclusion,tvmt_conclusion_date,tvmt_result)
      select r.id,s,'AGS-REP-PSTOR-'||s||'-'||((r.ordinal-1)/2+1),date '2026-09-10'+(s-2)*3,date '2026-09-11'+(s-2)*3,
        'AGS-REP-PSTOC-'||s||'-'||((r.ordinal-1)/2+1),'проведено',
        'AGS-REP-TVMTR-'||s||'-'||((r.ordinal-1)/2+1),date '2026-09-11'+(s-2)*3,
        'AGS-REP-TVMTC-'||s||'-'||((r.ordinal-1)/2+1),date '2026-09-12'+(s-2)*3,case when s=2 then 'не годен' else 'годен' end
      from ag_scale_rows r cross join generate_series(2,3) s where r.ordinal<=$1 order by r.ordinal,s`, [repeatJoints])

    await db.query(`create temporary table ag_scale_positions(storage text,title text,weld_id int,line text,subtitle text,
      kind text,relation_id int,sequence int,method text,event_date date) on commit drop`)
    for (const [storage, prefix, size] of [['weldingJournal', 'JSR2', 2], ['weldingJournal', 'JSR10', 10], ['checklist', 'CL', 10], ['zni', 'ZNI', 10]] as const) {
      await db.query(`insert into ag_scale_positions
        select $1,$2||((ordinal-1)/$3::int+1),id,line,subtitle,null,null,null,null,weld_date from ag_scale_rows`, [storage, `${documentPrefix}${prefix}-`, size])
    }
    for (const [storage, field, method, dateField, cycle] of [
      ['lnkRequest', 'vik_request', 'ВИК', 'vik_request_date', false],
      ['lnkRequest', 'rk_request', 'РК', 'rk_request_date', false],
      ['lnkRequest', 'uzk_request', 'УЗК', 'uzk_request_date', false],
      ['lnkConclusionVik', 'vik_conclusion', 'ВИК', 'vik_conclusion_date', false],
      ['lnkConclusionRk', 'rk_conclusion', 'РК', 'rk_conclusion_date', false],
      ['lnkConclusionUzk', 'uzk_conclusion', 'УЗК', 'uzk_conclusion_date', false],
      ['pstoRequest', 'psto_request', null, 'psto_request_date', true],
      ['pstoConclusion', 'heat_treatment_diagram', null, 'psto_date', true],
      ['tvmtRequest', 'tvmt_request', 'ТВМТ', 'tvmt_request_date', true],
      ['tvmtConclusion', 'tvmt_conclusion', 'ТВМТ', 'tvmt_conclusion_date', true],
    ] as const) {
      // Field identifiers are the fixed internal tuple above, never user input.
      await db.query(`insert into ag_scale_positions
        select $1,w.${field},w.id,r.line,r.subtitle,case when $3 then 'pstoCycle' end,
          case when $3 then w.id end,case when $3 then 1 end,$2,w.${dateField}
        from ag_scale_rows r join weld_joints w on w.id=r.id where w.${field} is not null`, [`system:${storage}`, method, cycle])
    }
    for (const [storage, field, method, dateField] of [
      ['lnkRequest', 'request_name', 'ВИК', 'request_date'], ['lnkRequest', 'request_name', 'РК', 'request_date'], ['lnkRequest', 'request_name', 'УЗК', 'request_date'],
      ['lnkConclusionVik', 'conclusion_name', 'ВИК', 'conclusion_date'], ['lnkConclusionRk', 'conclusion_name', 'РК', 'conclusion_date'], ['lnkConclusionUzk', 'conclusion_name', 'УЗК', 'conclusion_date'],
    ] as const) await db.query(`insert into ag_scale_positions
      select $1,c.${field},r.id,r.line,r.subtitle,'beforeHeatTreatment',c.id,null,c.method,c.${dateField}
      from pre_heat_treatment_controls c join ag_scale_rows r on r.id=c.weld_joint_id where c.method=$2`, [`system:${storage}`, method])
    for (const [storage, field, method, dateField] of [
      ['pstoRequest', 'psto_request', null, 'psto_request_date'], ['pstoConclusion', 'heat_treatment_diagram', null, 'psto_date'],
      ['tvmtRequest', 'tvmt_request', 'ТВМТ', 'tvmt_request_date'], ['tvmtConclusion', 'tvmt_conclusion', 'ТВМТ', 'tvmt_conclusion_date'],
    ] as const) await db.query(`insert into ag_scale_positions
      select $1,c.${field},r.id,r.line,r.subtitle,'pstoCycle',c.id,c.sequence,$2,c.${dateField}
      from psto_repeat_cycles c join ag_scale_rows r on r.id=c.weld_joint_id`, [`system:${storage}`, method])

    await db.query(`insert into generated_documents(type,title,file_name,mime_type,period_from,period_to,row_count,source_metadata,created_at,updated_at)
      select storage,title,'ag-grid-scale.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',min(event_date),max(event_date),count(distinct weld_id),
        jsonb_strip_nulls(jsonb_build_object('sourceKind',min(kind),'label',storage,
          'projects',jsonb_build_array($1::text),'subtitleCodes',jsonb_agg(distinct subtitle),'lines',jsonb_agg(distinct line),
          'positionCount',count(*),'methodCodes',coalesce(jsonb_agg(distinct method) filter(where method is not null),'[]'::jsonb),
          'cycleSequences',coalesce(jsonb_agg(distinct sequence) filter(where sequence is not null),'[]'::jsonb),
          'sourcePositions',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind',kind,'weldJointId',weld_id,
            'relationId',relation_id,'sequence',sequence,'methodCode',method)) order by weld_id,method) filter(where kind is not null),'[]'::jsonb)))::text,
        '2026-11-01T09:00:00Z','2026-11-02T09:10:11Z'
      from ag_scale_positions group by storage,title order by storage,title`, [AG_GRID_SCALE_PROJECT])
    await db.query(`insert into generated_document_weld_joints(document_id,weld_joint_id)
      select distinct d.id,p.weld_id from ag_scale_positions p
      join generated_documents d on d.type=p.storage and d.title=p.title`)

    const { rows: [counts] } = await db.query(`select
      (select count(*)::int from ag_scale_rows) joints,
      (select count(*)::int from weld_joints) database_joints,
      (select count(*)::int from line_programs where project_title=$1) lines,
      (select count(distinct stamp)::int from ag_scale_rows) used_stamps,
      (select count(distinct joint)::int from weld_joints where project_title=$1) joint_values,
      (select count(distinct isometry)::int from weld_joints where project_title=$1) isometry_values,
      (select count(*)::int from weld_joints where project_title=$1 and psto_required='да' and officiality='действующий' and revision_actuality='актуальная') report_joints,
      (select count(*)::int from ag_scale_rows where is_support) supports,
      (select count(*)::int from pre_heat_treatment_controls c join ag_scale_rows r on r.id=c.weld_joint_id) pre_controls,
      (select count(*)::int from psto_repeat_cycles c join ag_scale_rows r on r.id=c.weld_joint_id) repeat_cycles,
      (select count(*)::int from generated_documents) documents,
      (select count(*)::int from generated_document_weld_joints) relations,
      (select count(*)::int from ag_scale_positions) positions,
      (select count(*)::int from ag_scale_positions where kind is not null) stored_source_positions,
      (select sum((source_metadata::jsonb->>'positionCount')::int)::int from generated_documents) metadata_positions,
      (select sum(jsonb_array_length(source_metadata::jsonb->'sourcePositions'))::int from generated_documents) metadata_source_positions`, [AG_GRID_SCALE_PROJECT])
    const expected = { joints: count, database_joints: count + 1, lines: lineCount, used_stamps: stampCount,
      joint_values: count, isometry_values: count, report_joints: count, supports: count / 5,
      pre_controls: count * 2, repeat_cycles: count / 10, documents: count * 3, relations: count * 72 / 5,
      positions: count * 82 / 5, stored_source_positions: count * 42 / 5,
      metadata_positions: count * 82 / 5, metadata_source_positions: count * 42 / 5 }
    for (const [key, value] of Object.entries(expected)) equalCount(counts[key], value, key)
    const storageCounts = Object.fromEntries((await db.query<{ type: string; count: number }>(
      'select type,count(*)::int count from generated_documents group by type order by type')).rows.map(row => [row.type, row.count]))
    const expectedStorage = { weldingJournal: count * 3 / 5, checklist: count / 10, zni: count / 10,
      'system:lnkRequest': count * 3 / 5, 'system:lnkConclusionVik': count * 3 / 5,
      'system:lnkConclusionRk': count * 12 / 25, 'system:lnkConclusionUzk': count * 3 / 25,
      'system:pstoRequest': count / 10, 'system:pstoConclusion': count / 10,
      'system:tvmtRequest': count / 10, 'system:tvmtConclusion': count / 10 }
    equalCount(Object.keys(storageCounts).length, Object.keys(expectedStorage).length, 'storage type count')
    for (const [key, value] of Object.entries(expectedStorage)) equalCount(storageCounts[key], value, key)
    const stages = (await db.query(`select storage,coalesce(kind,'primary') kind,coalesce(sequence,0) sequence,
      count(distinct title)::int documents,count(*)::int positions from ag_scale_positions
      group by storage,kind,sequence order by storage,kind,sequence`)).rows
    const knownRows = (await db.query<{ id: number; ordinal: number; line: string; stamp: string; is_support: boolean }>(
      'select id,ordinal,line,stamp,is_support from ag_scale_rows where ordinal=any($1::int[]) order by ordinal',
      [[1, 81, repeatJoints, repeatJoints + 1, 10001, 14001, 18001, count]])).rows
    const knownLines = (await db.query<{ id: number; line: string; joints: number; stamps: number; welds: number; supports: number }>(`select p.id,p.line,
      count(*)::int joints,count(distinct r.stamp)::int stamps,count(*) filter(where not r.is_support)::int welds,
      count(*) filter(where r.is_support)::int supports from line_programs p join ag_scale_rows r on p.line=r.line
      where p.project_title=$1 and p.line=any($2::text[]) group by p.id,p.line order by p.line`, [AG_GRID_SCALE_PROJECT, heavyLines])).rows
    for (const row of knownLines) equalCount(row.joints, row.line === heavyLines[0] ? 10000 : 4000, row.line)
    equalCount(knownLines.length, 3, 'heavy lines')
    for (const table of ['weld_joints', 'line_programs', 'welder_stamps', 'weld_joint_program_states',
      'pre_heat_treatment_controls', 'psto_repeat_cycles', 'generated_documents', 'generated_document_weld_joints']) {
      await db.query(`analyze ${table}`)
    }
    return {
      version: 1, project: AG_GRID_SCALE_PROJECT, jointCount: count, lineCount, documentCounts: storageCounts,
      heavyLine: heavyLines[0], denseLine: heavyLines[1], denseStamps: Array.from({ length: 10 }, (_, n) => `Q${String(n).padStart(3, '0')}`),
      count, expected, counts, storageCounts, stages, knownLines,
      knownRows: knownRows.map(row => ({ ...row, joint: jointName(row.ordinal), isometry: isometryName(row.ordinal),
        currentCycle: row.ordinal <= repeatJoints ? 3 : 1, currentTvmtResult: 'годен' })),
      registryCounts: { generated: { weldingJournal: expectedStorage.weldingJournal, checklist: expectedStorage.checklist, zni: expectedStorage.zni },
        systemApi: { lnkRequest: count * 7 / 10, lnkConclusion: count * 13 / 10, pstoRequest: count / 10, pstoConclusion: count / 10 },
        uiTabs: { lnkRequest: count * 3 / 5, lnkConclusion: count * 6 / 5, tvmtRequest: count / 10, tvmtConclusion: count / 10 } },
      queryValues: { project: AG_GRID_SCALE_PROJECT, uniqueJoints: count, uniqueIsometries: count, uniqueStamps: stampCount,
        jointRemoteSearch: { match: 'F00000001', total: 8000, first: jointName(10001), last: jointName(19980) },
        exactJoint: jointName(count - 20), exactIsometry: isometryName(count - 20),
        heavyLine: heavyLines[0], nestedLine: heavyLines[1], skewedLine: heavyLines[2], nestedStamp: 'Q000',
        documents: { jsrLast: `AGS-JSR2-${count / 2}`, checklistLast: `AGS-CL-${count / 10}`, zniLast: `AGS-ZNI-${count / 10}` } },
      roles: { currentPrimaryJoints: count - repeatJoints, currentRepeatJoints: repeatJoints,
        priorFailedPrimaryAndRepeat2: repeatJoints, supports: count / 5, ordinaryJoints: count * 4 / 5,
        longJournalNotes: Math.floor(count / 7), longLnkNotes: Math.floor(count / 11) },
      limits: 'Registry/read fixture; preserve all application action limits. Positions count every source entry; stored_source_positions counts explicit primary/repeat/pre-TO sourcePositions. No warm dispatcher calculation is performed.',
    }
  })
  // withLineProgramFixture commits a new dirty dispatcher/derived revision
  // after its callback. Reading that committed state must not warm it.
  const calculation = await withE2eDatabase(async db => (await db.query(`select source_revision,computed_revision,full_rebuild
    from dispatcher_task_index_state where id=1`)).rows[0])
  if (!calculation || calculation.source_revision === calculation.computed_revision || !calculation.full_rebuild) {
    throw new Error('AG Grid scale fixture did not leave a dirty full calculation for the cold-index scenario')
  }
  return { ...manifest, calculation }
}

type AgGridScaleCalculationSignature = {
  joints: number
  jointIdentityHash: string
  finalStatusHash: string
  indexRows: number
  indexKeysHash: string
  indexCodeCounts: Record<string, number>
  pageCount: number
  pageScopeCount: number
  declaredTaskCount: number
  actualTaskCount: number
  invalidTaskIdentityCount: number
  pageCountMismatchCount: number
  pageSequenceErrorCount: number
  pageIdentityHash: string
}

/** Read only, after timed openings and before the runner drops its database.
 * One statement observes the atomically published index/pages/statuses together.
 * Hashes cover exact task keys, kinds, row references and page/card order.
 * They deliberately do not claim equality of full card payloads: relation and
 * row service timestamps differ across separately seeded disposable databases.
 * A separate joint identity hash checks the deterministic serial-ID mapping.
 */
export async function readAgGridScaleCalculationSignature() {
  return withE2eDatabase(async db => {
    const { rows: [signature] } = await db.query<AgGridScaleCalculationSignature>(`
      with fixture_rows as materialized (
        select id,subtitle_code,line,joint,isometry,final_status
        from weld_joints where project_title=$1
      ), index_rows as materialized (
        select t.weld_joint_id,t.task_key,t.code
        from dispatcher_row_tasks t join fixture_rows w on w.id=t.weld_joint_id
      ), pages as (
        select p.*,row_number() over(partition by scope_key order by page_number) expected_page
        from dispatcher_task_pages p where p.scope_key::jsonb->>0=$2
      ), page_signatures as materialized (
        select p.scope_key,p.page_number,p.task_count,p.expected_page,
          cards.actual_count,cards.invalid_identity_count,cards.identity_hash
        from pages p cross join lateral (
          select count(*)::int actual_count,
            count(*) filter(where jsonb_typeof(card.value->'kind') is distinct from 'string'
              or jsonb_typeof(card.value->'key') is distinct from 'string')::int invalid_identity_count,
            md5(coalesce(string_agg(md5(jsonb_build_array(card.position,
              card.value->>'kind',card.value->>'key',
              card.value->'row'->'id',card.value->'sourceRow'->'id')::text),
              '' order by card.position),'')) identity_hash
          from jsonb_array_elements(p.tasks::jsonb) with ordinality as card(value,position)
        ) cards
      )
      select
        (select count(*)::int from fixture_rows) as "joints",
        (select md5(coalesce(string_agg(md5(jsonb_build_array(id,subtitle_code,line,joint,isometry)::text),
          '' order by id),'')) from fixture_rows) as "jointIdentityHash",
        (select md5(coalesce(string_agg(md5(jsonb_build_array(id,final_status)::text),
          '' order by id),'')) from fixture_rows) as "finalStatusHash",
        (select count(*)::int from index_rows) as "indexRows",
        (select md5(coalesce(string_agg(md5(jsonb_build_array(weld_joint_id,task_key,code)::text),
          '' order by weld_joint_id,task_key),'')) from index_rows) as "indexKeysHash",
        (select coalesce(jsonb_object_agg(code,total order by code),'{}'::jsonb)
          from (select code,count(*)::int total from index_rows group by code) counts) as "indexCodeCounts",
        (select count(*)::int from page_signatures) as "pageCount",
        (select count(distinct scope_key)::int from page_signatures) as "pageScopeCount",
        (select coalesce(sum(task_count),0)::int from page_signatures) as "declaredTaskCount",
        (select coalesce(sum(actual_count),0)::int from page_signatures) as "actualTaskCount",
        (select coalesce(sum(invalid_identity_count),0)::int from page_signatures) as "invalidTaskIdentityCount",
        (select count(*) filter(where task_count<>actual_count)::int from page_signatures) as "pageCountMismatchCount",
        (select count(*) filter(where page_number<>expected_page)::int from page_signatures) as "pageSequenceErrorCount",
        (select md5(coalesce(string_agg(md5(jsonb_build_array(scope_key,page_number,task_count,identity_hash)::text),
          '' order by scope_key,page_number),'')) from page_signatures) as "pageIdentityHash"
    `, [AG_GRID_SCALE_PROJECT, AG_GRID_SCALE_PROJECT.trim().toLocaleLowerCase('ru-RU')])
    if (!signature) throw new Error('AG Grid scale calculation signature was not returned')
    return { version: 1, project: AG_GRID_SCALE_PROJECT, ...signature }
  })
}
