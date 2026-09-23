export const WORKFLOW_SELECTION_LIMIT = 5000
export const WORKFLOW_SELECTION_LIMIT_MESSAGE =
  'Можно выбрать не более 5 000 стыков за один раз. Прежний выбор сохранён. Уточните поиск или снимите часть выбора.'

export function assertWorkflowSelectionLimit(rowIds: readonly number[]) {
  if (new Set(rowIds).size > WORKFLOW_SELECTION_LIMIT) {
    throw new Error(WORKFLOW_SELECTION_LIMIT_MESSAGE)
  }
}
