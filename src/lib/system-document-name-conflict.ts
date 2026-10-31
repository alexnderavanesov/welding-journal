import { extractSystemNameNumber, type NamingPatternContext } from './request-conclusion-settings'
import { systemDocumentNameKey } from './system-document-name-allocation'
import { WorkflowConflictError, type WorkflowConflictCode } from './workflow-conflict'

/** Classify an already rejected preview. Client hints never authorize a save. */
export function changedSystemDocumentNameError({ pattern, namingPattern, context, date, provisionalName, occupiedNames, number }: {
  pattern: string; namingPattern?: string; context: NamingPatternContext; date: string
  provisionalName: string; occupiedNames: ReadonlySet<string>; number: number
}) {
  const shownNumber = Number(extractSystemNameNumber(pattern, context, provisionalName))
  let code: WorkflowConflictCode, reason: string
  if (occupiedNames.has(systemDocumentNameKey(date, provisionalName))) {
    code = 'DOCUMENT_NAME_OCCUPIED'
    reason = 'Показанное системное имя уже занято документом этого вида и даты.'
  } else if (namingPattern !== undefined && namingPattern !== pattern) {
    code = 'DOCUMENT_SETTINGS_CHANGED'
    reason = 'Правило системного имени изменилось после расчёта показанного названия.'
  } else if (shownNumber > 0 && shownNumber !== number) {
    code = 'DOCUMENT_NUMBER_CHANGED'
    reason = 'Порядковый номер изменился после расчёта показанного системного имени.'
  } else if (namingPattern !== undefined && !shownNumber) {
    code = 'DOCUMENT_CONTEXT_CHANGED'
    reason = 'Реквизиты или дата выбранных стыков не соответствуют показанному системному имени.'
  } else {
    // Old clients do not supply the preview's naming rule. Do not guess which
    // of the rule, date and row context changed from the name alone.
    code = 'DOCUMENT_PREVIEW_CHANGED'
    reason = 'Показанное системное имя не соответствует актуальному расчёту.'
  }
  return new WorkflowConflictError(code, `${reason} Ничего не сохранено. При создании откройте «…» рядом с разделением → «Обновить номера и имена»; при изменении готовых документов нажмите «Проверить изменения». Проверьте новые названия перед сохранением.`)
}
