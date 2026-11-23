import { useRef } from 'react'
import { useConfirmAction } from './confirm-action-context'
import { formatCustomDocumentName } from './report-request-naming'

/** A name edit on a position is a move, not a rename of its shared document. */
export function useDocumentPositionChange() {
  const confirm = useConfirmAction()
  const busy = useRef(false)
  return async ({ previousName, nextName, position, save }: {
    previousName: string
    nextName: string
    position: string
    save: () => void
  }) => {
    if (busy.current) return
    if (!previousName || formatCustomDocumentName(previousName) === formatCustomDocumentName(nextName)) {
      save()
      return
    }
    busy.current = true
    try {
      if (await confirm({
        title: 'Изменить документ только этой позиции',
        itemName: position,
        description: `«${previousName}» → «${formatCustomDocumentName(nextName)}». Только выбранная позиция выйдет из прежнего документа. Остальные позиции останутся в нём.`,
        warning: 'Если документа этого вида, этапа, названия и даты ещё нет, будет создан отдельный документ. Если совместимый документ уже есть, позиция присоединится к нему. Если это последняя позиция прежнего документа, пустой документ исчезнет из реестра. Назначения специалистов проверяются отдельно; при конфликте потребуется дополнительное подтверждение.',
        confirmLabel: 'Изменить документ этой позиции',
        tone: 'warning',
      })) save()
    } finally {
      busy.current = false
    }
  }
}
