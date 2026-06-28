import { Button } from '@/components/ui/button'

type DialogCloseFooterProps = {
  onClose: () => void
  borderClassName?: string
}

export function DialogCloseFooter({
  onClose,
  borderClassName = 'border-slate-200/80',
}: DialogCloseFooterProps) {
  return (
    <div className={`flex justify-end gap-2 border-t ${borderClassName} px-5 py-4`}>
      <Button variant="outline" onClick={onClose}>
        Закрыть
      </Button>
    </div>
  )
}
