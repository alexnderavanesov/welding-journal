import { FieldHelp } from './field-help'
import { ACCESS_AREAS, ACCESS_ACTIONS, AREA_ACTIONS, type AccessArea, type AccessAction, type Permission } from '@/lib/access-permissions'

const AREA_HELP: Record<AccessArea, string> = {
  welding: 'Стыки, параметры сварки, клейма и примечания сварочного журнала. Результаты ЛНК и ПСТО настраиваются отдельно.',
  lnk: 'Отчёт ЛНК, результаты неразрушающего контроля, заявки и заключения ЛНК.',
  psto: 'ПСТО и ТВМТ: заявки, результаты, заключения, повторы и примечания термообработки.',
  lines: 'Программа контроля линий: назначение и отмена программ, объёмы контроля и клейма.',
  references: 'Карточки сварщиков, НАКС, ДЛС, специалисты, технологии и другие рабочие справочники.',
  statistics: 'Статистика по сварщикам и линиям. Это просмотр итогов, а не изменение исходных стыков.',
  documents: 'Реестры созданных документов и их состав. Доступ к сведениям ЛНК и ПСТО дополнительно зависит от прав соответствующего раздела.',
  templates: 'Настройки → Документы: загрузка, редактирование и удаление шаблонов Excel. Формирование готовых документов выдаётся отдельно.',
  checks: 'Настройки → Правила и проверки: проверки, которые выполняются при сохранении стыка (СП).',
  dispatcher: 'Настройки диспетчера: задачи ДЗ, напоминания и фоновый пересчёт. Не даёт права исправлять сами стыки.',
  exceptions: 'Просмотр и изменение принятых исключений из правил. Само наличие этого права не отключает проверки.',
  numbering: 'Настройки → Заявки и заключения: состав названий, правила нумерации и разделения документов.',
  data: 'Настройки → Данные: списки способов сварки, типов соединений, групп материалов и видов испытаний. Например: РАД, У19, М01, ГИ.',
  wdi: 'Настройки расчёта дюймов (WDI): формулы и правила подсчёта для разных типов соединений.',
  processes: 'Настройки → Процессы контроля: включение и отключение этапов контроля. Существующие ограничения и проверки сохраняются.',
  indexes: 'Настройки → Системные индексы: обозначения обычных стыков, ремонтов, вырезов и катушек (S, F, R, W, Y). Это не индексы базы данных.',
}
const ACTION_HELP: Record<AccessAction, string> = {
  view: 'Открывать раздел и видеть его данные. При снятии просмотра отключаются остальные действия этой строки.',
  edit: 'Создавать и редактировать доступные записи или настройки. Импорт, удаление, документы и выгрузка выдаются отдельно.',
  import: 'Импортировать Excel, выполнять массовое заполнение и замену данных сварочного журнала. Проверки сохранения продолжают действовать.',
  delete: 'Удалять записи или отменять операции соответствующего раздела. Подтверждения и проверки зависимостей сохраняются.',
  generate: 'Создавать и пересобирать документы раздела: заявки, заключения и отчётные формы. Для связанных разделов могут понадобиться их права.',
  export: 'Скачивать файлы и печатать доступные данные раздела. Не разрешает менять эти данные.',
}

export function PermissionEditor({ value, onChange, disabled = false }: {
  value: readonly Permission[]; onChange?: (value: Permission[]) => void; disabled?: boolean
}) {
  const toggle = (permission: Permission, checked: boolean) => {
    if (disabled || !onChange) return
    const area = permission.split('.')[0]
    onChange(checked ? [...new Set([...value, permission, ...(area !== 'history' ? [`${area}.view` as Permission] : [])])] : value.filter(item => item !== permission && !(permission.endsWith('.view') && area !== 'history' && item.startsWith(`${area}.`))))
  }
  const checkbox = (permission: Permission, label: string) => <input type="checkbox" aria-label={label} checked={value.includes(permission)}
    disabled={disabled || !onChange} onChange={event => toggle(permission, event.target.checked)}
    className="h-4 w-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:cursor-default disabled:opacity-70" />
  return <div className="space-y-4">
    <p className="text-sm leading-6 text-slate-500">Наведите на <span className="font-medium text-slate-700">ⓘ</span> или нажмите, чтобы прочитать пояснение. Действие автоматически включает просмотр раздела. Прочерк — отдельного разрешения нет.</p>
    <div className="min-w-[850px] rounded-xl border border-slate-200">
      <table className="w-full min-w-[850px] table-fixed text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr><th scope="col" className="w-[26%] px-4 py-3 text-left font-medium">Раздел и настройки</th>{(Object.entries(ACCESS_ACTIONS) as [AccessAction, string][]).map(([action, label]) => <th scope="col" key={action} className="px-2 py-3 text-center font-medium"><span>{label} </span><FieldHelp label={`О праве «${label}»`}>{ACTION_HELP[action]}</FieldHelp></th>)}</tr></thead>
        <tbody>{(Object.entries(ACCESS_AREAS) as [AccessArea, string][]).map(([area, label], index) => <tr key={area} className={`${index === 7 ? 'border-t-2' : 'border-t'} border-slate-200 hover:bg-sky-50/50`}>
          <th scope="row" className="px-4 py-3 text-left font-medium text-slate-700"><span className="flex items-center justify-between gap-2">{label}<FieldHelp label={`О разделе «${label}»`}>{AREA_HELP[area]}</FieldHelp></span></th>
          {(Object.keys(ACCESS_ACTIONS) as AccessAction[]).map(action => <td key={action} className="px-2 py-3 text-center">{AREA_ACTIONS[area].includes(action)
            ? checkbox(`${area}.${action}`, `${label}: ${ACCESS_ACTIONS[action]}`) : <span aria-label="Не применяется" className="text-slate-300">—</span>}</td>)}
        </tr>)}
        {([
          { permission: 'history.view', label: 'Журнал действий', help: 'Кто, когда и что изменил во всей доступной пользователю истории. Скрытые разделы не раскрываются.' },
          { permission: 'history.joint', label: 'История отдельного стыка', help: 'Изменения выбранного стыка. Дополнительно нужен просмотр сварочного журнала. Скрытые разделы не раскрываются.' },
        ] as const).map(({ permission, label, help }, index) => <tr key={permission} className={`${index === 0 ? 'border-t-2' : 'border-t'} border-slate-200 hover:bg-sky-50/50`}>
          <th scope="row" className="px-4 py-3 text-left font-medium text-slate-700"><span className="flex items-center justify-between gap-2">{label}<FieldHelp label={`О разделе «${label}»`}>{help}</FieldHelp></span></th>
          {(Object.keys(ACCESS_ACTIONS) as AccessAction[]).map(action => <td key={action} className="px-2 py-3 text-center">{action === 'view'
            ? checkbox(permission, `${label}: Просмотр`) : <span aria-label="Не применяется" className="text-slate-300">—</span>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>
}
