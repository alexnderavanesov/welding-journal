import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { weldJoints } from '@/db/schema'
import type { RkExposureTableSettings } from '@/lib/other-settings'
import { RK_EXPOSURE_CUSTOM_SCHEME_LABEL, RK_EXPOSURE_REVIEW_LABEL } from '@/lib/rk-exposure'
import { reportTextSql } from './report-filter-text-sql'

function rkDescriptionSqlParts(value: SQLWrapper) {
  const line = reportTextSql(sql`"rk_line"`)
  const colon = sql`position(':' in ${line})`
  const coordinate = reportTextSql(sql`case when ${colon} = 0 then ${line} else left(${line}, ${colon} - 1) end`)
  const description = reportTextSql(sql`case when ${colon} = 0 then '' else substring(${line} from ${colon} + 1) end`)
  const source = sql`regexp_split_to_table(coalesce(${value}::text, ''), E'\\r?\\n') with ordinality as "rk_lines"("rk_line", "rk_position")`
  return { coordinate, description, source }
}

/** Same ordered, nonempty-coordinate lines as parseRkExposureDescription. */
export function rkDescriptionPartsSql(value: SQLWrapper, part: 'coordinate' | 'description') {
  const { coordinate, description, source } = rkDescriptionSqlParts(value)
  return sql<string[]>`array(select ${part === 'coordinate' ? coordinate : description}
    from ${source} where ${coordinate} <> '' ${part === 'description' ? sql`and ${description} <> ''` : sql``}
    order by "rk_position")`
}

export function buildRkExposureSchemeSql(table: RkExposureTableSettings | null): SQL<string> {
  if (!table?.entries.length) {
    // Only presence is needed without a configured table; do not construct an
    // ordered array of every defect line for every joint in the selection.
    const { coordinate, source } = rkDescriptionSqlParts(weldJoints.lnkDefectDescription)
    return sql<string>`case when exists(select 1 from ${source} where ${coordinate} <> '')
      then ${RK_EXPOSURE_CUSTOM_SCHEME_LABEL} else '' end`
  }
  const coordinates = sql`"rk_scheme_values"."coordinates"`
  const currentEntry = sql`"rk_scheme_values"."current_entry"`
  const confirmedEntry = sql`"rk_scheme_values"."confirmed_entry"`
  const customOrEmpty = sql<string>`case when cardinality(${coordinates}) > 0 then ${RK_EXPOSURE_CUSTOM_SCHEME_LABEL} else '' end`
  const diameter = sql`case when upper(${reportTextSql(weldJoints.connectionType)}) like 'У%'
    then least(${weldJoints.d1}, ${weldJoints.d2}) else greatest(${weldJoints.d1}, ${weldJoints.d2}) end`
  // The first entry also applies below its first boundary, matching the UI.
  // A balanced decision tree needs log2(N) comparisons per joint, rather than
  // walking a large uploaded table again for each of 200,000 joints.
  const entryIndex = (dimension: SQLWrapper) => {
    const locate = (first: number, last: number): SQL => {
      if (first === last) return sql`${first}`
      const middle = Math.ceil((first + last) / 2)
      return sql`case when ${dimension} < ${table.entries[middle].diameter}
        then ${locate(first, middle - 1)} else ${locate(middle, last)} end`
    }
    return sql`(case when ${dimension} is null then null else ${locate(0, table.entries.length - 1)} end)::integer`
  }
  // Bind the options once as jsonb, then inspect only the selected entry's
  // options. Flattening every option into CASE made large tables much slower.
  const options = JSON.stringify(table.entries.map(entry => entry.options.map(option => ({
    label: option.label, values: option.values.map(value => value.trim()),
  }))))
  const configured = sql`(select "rk_option"."value" ->> 'label'
    from jsonb_array_elements(${options}::jsonb -> ${currentEntry})
      with ordinality as "rk_option"("value", "position")
    where "rk_option"."value" -> 'values' = to_jsonb(${coordinates})
    order by "rk_option"."position" limit 1)`
  // OFFSET 0 keeps the scalar projection from being flattened: parse a defect
  // description once, not once per configured option. Table parameters grow
  // linearly rather than duplicating the diameter CASE for every option.
  return sql<string>`(select case when ${currentEntry} <> ${confirmedEntry} then ${RK_EXPOSURE_REVIEW_LABEL}
    else coalesce(${configured}, ${customOrEmpty}) end
    from (select ${entryIndex(diameter)} as "current_entry",
      ${entryIndex(weldJoints.rkExposureConfirmedDiameter)} as "confirmed_entry",
      ${rkDescriptionPartsSql(weldJoints.lnkDefectDescription, 'coordinate')} as "coordinates"
      offset 0) as "rk_scheme_values")`
}
