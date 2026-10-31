import { Checkbox } from './ui/checkbox'
import { FieldHelp } from './field-help'

export function DocumentIssuesFilter({ checked, count, stale = false, onChange }: {
  checked: boolean
  count: number
  stale?: boolean
  onChange: (checked: boolean) => void
}) {
  return <div className="mt-2 flex items-center gap-2 text-xs text-rose-700">
    <label className="flex cursor-pointer items-center gap-2">
      <Checkbox checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>Только проблемные группы — {count} во всём списке{stale ? ' (по предыдущей проверке)' : ''}</span>
    </label>
    <FieldHelp label="Что значит «Только проблемные группы»">
      <p>Каждая группа — стыки, которые войдут в один документ.</p>
      <p className="mt-1">Включите фильтр, чтобы оставить только документы с ошибками: например, не заполнены данные стыков или нужно исправить название. Причина указана рядом с документом.</p>
      <p className="mt-1">Если не указан проект, шифр или линия, заполните эти поля у стыка в сварочном журнале.</p>
      <p className="mt-1">Число справа учитывает весь список, включая другие страницы. Фильтр ничего не удаляет и не меняет выбор стыков.</p>
      {stale ? <p className="mt-1">Вы изменили параметры. Нажмите «Проверить изменения», чтобы обновить список ошибок.</p> : null}
    </FieldHelp>
  </div>
}
