import { Archive, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatWelderStampDiameterRange, formatWelderStampValidity } from '@/lib/welder-stamp-format'
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
            <tr
              key={record.id}
              className={
                archived
                  ? 'bg-slate-50 text-slate-500'
                  : record.id === editingId
                    ? 'bg-sky-50'
                    : 'odd:bg-white even:bg-slate-50/60'
              }
            >
              <td className={`border-t border-slate-200 px-3 py-3 text-center font-semibold ${archived ? '' : 'text-slate-900'}`}>
                {record.naksStamp || '-'}
              </td>
              <td className={`border-t border-slate-200 px-3 py-3 text-center ${archived ? '' : 'text-slate-700'}`}>
                {record.internalStamp || '-'}
              </td>
              <td className={`border-t border-slate-200 px-3 py-3 text-center ${archived ? '' : 'text-slate-700'}`}>
                {record.weldType || '-'}
              </td>
              <td className={`border-t border-slate-200 px-3 py-3 text-center ${archived ? '' : 'text-slate-700'}`}>
                {formatWelderStampDiameterRange(record)}
              </td>
              <td className={`border-t border-slate-200 px-3 py-3 text-center ${archived ? '' : 'text-slate-700'}`}>
                {formatWelderStampValidity(record)}
              </td>
              <td className="border-t border-slate-200 px-3 py-2">
                <div className="flex justify-center gap-1.5">
                  {archived ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-sky-200 text-sky-700 hover:bg-sky-50"
                      onClick={() => onRestore?.(record.id)}
                      title="Вернуть в общий список"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onEdit?.(record)}
                        title="Редактировать клеймо"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        onClick={() => onArchive?.(record.id)}
                        title="Добавить в архив"
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() => onDelete(record.id)}
                    title="Удалить клеймо"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
