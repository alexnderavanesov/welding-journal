import { Edit2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WeldFieldKey, WeldInput } from '@/lib/weld-fields'

type WeldTableEditActionsCellProps = {
  row: WeldInput & { id: number }
  onEdit?: (row: WeldInput & { id: number }, fieldKey?: WeldFieldKey) => void
  onDelete?: (id: number) => void
}

export function WeldTableEditActionsCell({ row, onEdit, onDelete }: WeldTableEditActionsCellProps) {
  return (
    <td className="border-b border-slate-100 px-3 py-2 text-right">
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
