import { WelderStampsRecordRow } from '@/components/welder-stamps-record-row'
import type { WelderStampRecord } from '@/lib/welder-stamp-types'

type WelderStampsRecordsTableProps = {
  records: WelderStampRecord[]
  emptyMessage: string
  editingId?: number | null
  selectedId?: number | null
  onSelect?: (record: WelderStampRecord) => void
  onEdit?: (record: WelderStampRecord, focusPermitId?: string) => void
  onArchive?: (id: number) => void
  onRestore?: (id: number) => void
  onArchivePermit?: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onRestorePermit?: (recordId: number, permitKind: 'naks' | 'dls', permitId: string) => void
  onDelete: (id: number) => void
}

export function WelderStampsRecordsTable({
  records,
  emptyMessage,
  editingId = null,
  selectedId = null,
  onSelect,
  onEdit,
  onArchive,
  onRestore,
  onArchivePermit,
  onRestorePermit,
  onDelete,
}: WelderStampsRecordsTableProps) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <thead className="bg-slate-100 text-center text-slate-700">
        <tr>
          <th className="w-[13%] border-r border-white px-3 py-3 font-semibold">Клеймо НАКС</th>
          <th className="w-[20%] border-r border-white px-3 py-3 font-semibold">ФИО сварщика</th>
          <th className="w-[12%] border-r border-white px-3 py-3 font-semibold">Внутреннее</th>
          <th className="w-[10%] border-r border-white px-3 py-3 font-semibold">Статус</th>
          <th className="w-[14%] border-r border-white px-3 py-3 font-semibold">Способ</th>
          <th className="w-[14%] border-r border-white px-3 py-3 font-semibold">Группа</th>
          <th className="w-[9%] border-r border-white px-3 py-3 font-semibold">НАКС</th>
          <th className="w-[8%] px-3 py-3 font-semibold">ДЛС</th>
        </tr>
      </thead>
      <tbody>
        {records.length === 0 ? (
          <tr>
            <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          records.map((record) => (
            <WelderStampsRecordRow
              key={record.id}
              record={record}
              editingId={editingId}
              selectedId={selectedId}
              onSelect={onSelect}
              onEdit={onEdit}
              onArchive={onArchive}
              onRestore={onRestore}
              onArchivePermit={onArchivePermit}
              onRestorePermit={onRestorePermit}
              onDelete={onDelete}
            />
          ))
        )}
      </tbody>
    </table>
  )
}
