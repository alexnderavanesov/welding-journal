import { WelderStampsRecordRow } from '@/components/welder-stamps-record-row'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampsRecordsTableProps = {
  records: WelderStampRecord[]
  emptyMessage: string
  editingId?: number | null
  archived?: boolean
  onEdit?: (record: WelderStampRecord) => void
  onArchive?: (id: number) => void
  onRestore?: (id: number) => void
  onDelete: (id: number) => void
}

export function WelderStampsRecordsTable({
  records,
  emptyMessage,
  editingId = null,
  archived = false,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: WelderStampsRecordsTableProps) {
  return (
    <table className="w-full min-w-[980px] border-collapse text-sm">
      <thead className="bg-slate-100 text-center text-slate-700">
        <tr>
          <th className="border-r border-white px-3 py-3 font-semibold">Клеймо НАКС</th>
          <th className="border-r border-white px-3 py-3 font-semibold">Клеймо внутреннее</th>
          <th className="border-r border-white px-3 py-3 font-semibold">Тип сварки</th>
          <th className="border-r border-white px-3 py-3 font-semibold">Диапазон диаметра</th>
          <th className="border-r border-white px-3 py-3 font-semibold">Срок действия</th>
          <th className={`${archived ? 'w-40' : 'w-32'} px-3 py-3 font-semibold`}>Действия</th>
        </tr>
      </thead>
      <tbody>
        {records.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          records.map((record) => (
            <WelderStampsRecordRow
              key={record.id}
              record={record}
              editingId={editingId}
              archived={archived}
              onEdit={onEdit}
              onArchive={onArchive}
              onRestore={onRestore}
              onDelete={onDelete}
            />
          ))
        )}
      </tbody>
    </table>
  )
}
