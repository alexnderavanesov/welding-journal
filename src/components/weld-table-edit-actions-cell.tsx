import { Edit2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'

type WeldTableEditActionsCellProps = {
  row: WeldRow
  onEdit?: (row: WeldRow, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
}

export function WeldTableEditActionsCell({ row, onEdit, onDelete }: WeldTableEditActionsCellProps) {
  return (
    <td className="border-b border-r-2 border-b-[#edf2f7] border-r-[#d7e4ee] px-3 py-2 text-right">
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={(event) => {
            event.stopPropagation()
            onEdit?.(row)
          }}
          aria-label="Редактировать"
        >
          <Edit2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={(event) => {
            event.stopPropagation()
            onDelete?.(row.id)
          }}
          aria-label="Удалить"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </td>
  )
}
