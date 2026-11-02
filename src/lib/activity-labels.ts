import { ACCESS_ACTIONS, ACCESS_AREAS } from './access-permissions'
import { WELD_FIELDS } from './weld-fields'
import { GENERATED_DOCUMENT_PROFILES, isGeneratedDocumentType } from './generated-document-types'
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
  sourceKind: 'Этап контроля', cycleSequences: 'Циклы ПСТО', methodCode: 'Метод контроля', methodCodes: 'Методы контроля',
  positionCount: 'Количество позиций', projects: 'Проекты', subtitleCodes: 'Шифры', lines: 'Линии',
  sourcePositions: 'Позиции документа', rowIds: 'Стыки (ID)', relationId: 'Запись контроля (ID)', label: 'Вид документа',
  first: 'Специалист 1', second: 'Специалист 2', sha256: 'Контрольная сумма',
}
const documentTypes: Record<string, string> = {
  lnkRequest: 'Заявка ЛНК', lnkConclusion: 'Заключение ЛНК', pstoRequest: 'Заявка ПСТО', pstoConclusion: 'Заключение ПСТО',
  lnkConclusionVik: 'Заключение ВИК', lnkConclusionRk: 'Заключение РК', lnkConclusionPvk: 'Заключение ПВК', lnkConclusionUzk: 'Заключение УЗК', tvmtConclusion: 'Заключение ТВМТ',
}
const sourceKinds: Record<string, string> = { beforeHeatTreatment: 'НК до ТО', pstoCycle: 'ПСТО / ТВМТ', pstoRepeat: 'Повторное ПСТО / ТВМТ' }
export function activityFieldLabel(entity: string, key: string) {
  if (key === 'name' && ['account', 'specialists'].includes(entity)) return 'ФИО'
  if (entity === 'account' && key === 'title') return 'Должность'
  return weldLabels.get(key) ?? fieldLabels[key] ?? key
}
export function activityValueLabel(entity: string, key: string, value: unknown): string {
  if (value === undefined) return 'Не задано'
  if (value === null || value === '') return 'Пусто'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (key === 'type' && entity === 'generated_documents') {
    const type = String(value).replace(/^system:/, '')
    return documentTypes[type] ?? (isGeneratedDocumentType(type) ? GENERATED_DOCUMENT_PROFILES[type].label : String(value))
  }
  if (key === 'sourceKind' || key === 'kind' && entity === 'document_position') return sourceKinds[String(value)] ?? String(value)
  if (key === 'mimeType' || key === 'fileType') return ({ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel (.xlsx)', 'application/vnd.ms-excel': 'Excel (.xls)', 'application/pdf': 'PDF', xlsx: 'Excel (.xlsx)', xls: 'Excel (.xls)', pdf: 'PDF' } as Record<string, string>)[String(value)] ?? String(value)
  if (typeof value === 'string' && /(?:date|periodFrom|periodTo|validFrom|validTo|suspendedFrom|suspendedTo|At)$/i.test(key)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('.')
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) return `${new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК`
  }
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
const operationLabels: Record<string, string> = {
  createWeldJoint: 'Создание стыка', createWeldJoints: 'Создание стыков', updateWeldJoint: 'Изменение стыка', updateWeldJoints: 'Изменение стыков',
  deleteWeldJoint: 'Удаление стыка', deleteWeldJoints: 'Удаление стыков', deleteObsoleteRepeatedJoint: 'Удаление неактуального повторного стыка',
  importWeldJoints: 'Импорт стыков', massFillWeldJoints: 'Массовое заполнение стыков', replaceWeldJoints: 'Замена стыков при импорте',
  moveWeldJointChain: 'Перенос цепочки стыка', setChainActuality: 'Изменение актуальности цепочки',
  savePreHeatTreatmentLnkWorkflow: 'Заявки и результаты НК до ТО', savePreHeatTreatmentLnkResultEdits: 'Изменение результатов НК до ТО',
  correctPreHeatTreatmentLnkResult: 'Корректировка результата НК до ТО', updatePreHeatTreatmentRkExposure: 'Изменение схемы просвечивания РК',
  savePstoRepeatWorkflow: 'Заявки и результаты ПСТО / ТВМТ', correctPstoCycleStage: 'Корректировка этапа ПСТО / ТВМТ',
  correctPstoTvmtAndRemoveLaterCycles: 'Корректировка ТВМТ с удалением последующих циклов',
  saveDuplicateControl: 'Сохранение дублирующего контроля', saveDuplicateControls: 'Сохранение дублирующих контролей', deleteDuplicateControl: 'Удаление дублирующего контроля',
  extendLnkRequest: 'Дополнение заявки ЛНК', clearLnkRequestPosition: 'Удаление позиции заявки ЛНК', updateLnkDefectDescription: 'Изменение описания дефектов',
  manageLnkRequestDocument: 'Изменение заявки ЛНК', managePstoRequestDocument: 'Изменение заявки ПСТО', changeSystemDocumentDate: 'Изменение даты документа',
  applyDocumentOperation: 'Изменение документов', saveRemoteGeneratedDocuments: 'Сохранение сформированных документов', deleteRemoteGeneratedDocument: 'Удаление документа',
  assignDocumentSpecialists: 'Назначение специалистов документа', saveSpecialist: 'Сохранение специалиста', archiveSpecialist: 'Перевод специалиста в архив',
  saveWelderStampRecords: 'Сохранение клейм сварщиков', saveWelderStampSuspensionRecords: 'Изменение приостановок клейм',
  saveLineProgram: 'Сохранение программы линии', deleteLineProgram: 'Удаление программы линии', applyLineProgramControl: 'Изменение контроля по программе линии',
  changeLayeredControl: 'Изменение послойного контроля', savePstoLineAssignment: 'Изменение назначения ПСТО на линиях', changeLineProgramApprovals: 'Изменение согласований программы',
  savePstoChainException: 'Сохранение исключения ПСТО', closeEmptyPstoChainException: 'Закрытие исключения ПСТО',
  acceptDispatcherWarning: 'Принятие исключения диспетчера', revokeDispatcherAcceptedWarning: 'Отмена принятого исключения',
  saveAppSetting: 'Изменение настроек', recalculateWdi: 'Пересчёт дюймов',
}
export function activityActionLabel(action: string, area?: string) {
  if (accountLabels[action]) return accountLabels[action]
  if (operationLabels[action]) return operationLabels[action]
  const verb = /delete|remove|cancel|clear|archive|revoke/i.test(action) ? 'Удаление / отмена' : /import|massFill|replace/i.test(action) ? 'Импорт / массовое изменение' : /create|invite|generate/i.test(action) ? 'Создание' : /recalculate|refresh/i.test(action) ? 'Пересчёт' : 'Изменение'
  const inferred = area ?? (/Lnk|Duplicate|PreHeat/i.test(action) ? 'lnk' : /Psto|Tvmt/i.test(action) ? 'psto' : /WeldJoint|WeldJoints|Coil|Chain/i.test(action) ? 'welding' : /DocumentTemplate/i.test(action) ? 'templates' : /Document/i.test(action) ? 'documents' : /Account/i.test(action) ? 'access' : /LineProgram/i.test(action) ? 'lines' : /Welder|Specialist|TechnologyCard/i.test(action) ? 'references' : '')
  return `${verb}${inferred ? ` · ${ACCESS_AREAS[inferred as keyof typeof ACCESS_AREAS] ?? 'Доступ'}` : ''}`
}
