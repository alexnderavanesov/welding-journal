import { ACCESS_ACTIONS, ACCESS_AREAS } from './access-permissions'
import { WELD_FIELDS } from './weld-fields'
const weldLabels = new Map<string, string>(WELD_FIELDS.map(field => [field.key, field.label]))
const fieldLabels: Record<string, string> = {
  id: 'ID записи', lineProgramId: 'Программа линии (ID)', weldJointId: 'Стык (ID)', documentId: 'Документ (ID)',
  technologyCardId: 'Технологическая карта (ID)', welderStampId: 'Клеймо (ID)',
  name: 'Название', title: 'Название', email: 'Почта', role: 'Уровень доступа', permissions: 'Права', status: 'Состояние',
  kind: 'Вид записи', type: 'Тип документа', key: 'Ключ настройки / записи', value: 'Значение настройки',
  method: 'Метод контроля', methods: 'Методы контроля', result: 'Результат', controlDate: 'Дата контроля',
  requestName: 'Заявка', requestDate: 'Дата заявки', conclusion: 'Заключение', conclusionName: 'Заключение', conclusionDate: 'Дата заключения',
  defectDescription: 'Описание дефектов', rkExposureConfirmedDiameter: 'Подтверждённый диаметр для РК', sequence: 'Номер цикла',
  configurationIssue: 'Ошибка настройки программы', pstoAssignment: 'Назначение ПСТО', pstoCancellationBasis: 'Основание отмены ПСТО',
  pstoExceptionBasis: 'Основание исключения ПСТО', preHeatTreatmentLnkExempt: 'Освобождение от НК до ТО',
  pvkControlPercent: 'Объём ПВК, %', layeredControlAssigned: 'Послойный контроль назначен',
  rootJoint: 'Исходный стык цепочки', required: 'ПСТО требуется', basis: 'Основание', closedAt: 'Дата закрытия', closeReason: 'Причина закрытия',
  naksStamp: 'Клеймо НАКС', welderName: 'ФИО сварщика', internalStamp: 'Внутреннее клеймо', weldType: 'Способ сварки',
  weldingMethods: 'Способы сварки', materialGroups: 'Группы материалов', diameterFrom: 'Диаметр от', diameterTo: 'Диаметр до',
  thicknessFrom: 'Толщина от', thicknessTo: 'Толщина до', validFrom: 'Начало действия', validTo: 'Окончание действия',
  naksPermits: 'Допуски НАКС', dlsPermits: 'Допуски ДЛС', archived: 'В архиве', archivedAt: 'Дата перевода в архив',
  suspendedFrom: 'Приостановлено с', suspendedTo: 'Приостановлено до', certificate: 'Удостоверение', psto: 'Условие ПСТО',
  code: 'Код правила', context: 'Контекст исключения', acceptedAt: 'Дата принятия исключения',
  fileName: 'Имя файла', fileType: 'Формат файла', mimeType: 'Формат файла', fileSize: 'Размер файла',
  blobKey: 'Версия файла (контрольная сумма)', fileData: 'Содержимое файла (контрольная сумма)', fileDataBase64: 'Содержимое файла (контрольная сумма)',
  metadata: 'Описание шаблона (контрольная сумма)', options: 'Параметры шаблона', constructorConfig: 'Настройки конструктора (контрольная сумма)',
  uploadedAt: 'Дата загрузки', periodFrom: 'Начало периода', periodTo: 'Конец периода', rowCount: 'Количество стыков',
  wdiTotal: 'Всего дюймов', documentNumber: 'Номер документа', sourceMetadata: 'Состав и этап документа', specialists: 'Специалисты и подписи',
}
export function activityFieldLabel(entity: string, key: string) {
  if (key === 'name' && ['account', 'specialists'].includes(entity)) return 'ФИО'
  if (entity === 'account' && key === 'title') return 'Должность'
  return weldLabels.get(key) ?? fieldLabels[key] ?? key
}
export function activityValueLabel(entity: string, key: string, value: unknown): string {
  if (value === undefined) return 'Не задано'
  if (value === null || value === '') return 'Пусто'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (entity === 'account' && key === 'role') return ({ owner: 'Владелец', admin: 'Администратор', user: 'Пользователь' } as Record<string, string>)[String(value)] ?? String(value)
  if (entity === 'account' && key === 'permissions' && Array.isArray(value)) return value.length ? value.map(permission => {
    if (permission === 'history.view') return 'Общий журнал действий'
    if (permission === 'history.joint') return 'История отдельного стыка'
    const [area, action] = String(permission).split('.')
    return `${ACCESS_AREAS[area as keyof typeof ACCESS_AREAS] ?? area}: ${ACCESS_ACTIONS[action as keyof typeof ACCESS_ACTIONS] ?? action}`
  }).join('; ') : 'Нет отдельных разрешений'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
const accountLabels: Record<string, string> = {
  'kind:create': 'Создание', 'kind:update': 'Изменение', 'kind:delete': 'Удаление', 'source:import': 'Импорт / массовое заполнение', 'source:access': 'Аккаунты и доступ',
  'account.invite': 'Приглашение пользователя', 'account.activated': 'Активация аккаунта', 'account.recovered': 'Восстановление доступа',
  'account.delete': 'Удаление аккаунта', 'account.profile': 'Изменение профиля', 'account.permissions': 'Изменение прав',
  'account.password.changed': 'Смена пароля', 'account.owner.prepared': 'Подготовка владельца', 'account.owner.recovery': 'Восстановление владельца',
  'account.invite.requested': 'Повтор приглашения', 'account.recovery.requested': 'Отправка восстановления',
}
export function activityActionLabel(action: string, area?: string) {
  if (accountLabels[action]) return accountLabels[action]
  const verb = /delete|remove|cancel|clear|archive|revoke/i.test(action) ? 'Удаление / отмена' : /import|massFill|replace/i.test(action) ? 'Импорт / массовое изменение' : /create|invite|generate/i.test(action) ? 'Создание' : /recalculate|refresh/i.test(action) ? 'Пересчёт' : 'Изменение'
  const inferred = area ?? (/Lnk|Duplicate|PreHeat/i.test(action) ? 'lnk' : /Psto|Tvmt/i.test(action) ? 'psto' : /WeldJoint|WeldJoints|Coil|Chain/i.test(action) ? 'welding' : /DocumentTemplate/i.test(action) ? 'templates' : /Document/i.test(action) ? 'documents' : /Account/i.test(action) ? 'access' : /LineProgram/i.test(action) ? 'lines' : /Welder|Specialist|TechnologyCard/i.test(action) ? 'references' : '')
  return `${verb}${inferred ? ` · ${ACCESS_AREAS[inferred as keyof typeof ACCESS_AREAS] ?? 'Доступ'}` : ''}`
}
