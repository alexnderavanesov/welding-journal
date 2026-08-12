import type { DispatcherTask } from '@/lib/dispatcher-types'

const ACCEPTABLE_PERCENTAGE_LINE_ISSUES = new Set([
  'excess',
  'new-welder',
  'rejected-primary',
  'suspend-welder',
])

export function canAcceptDispatcherTask(task: DispatcherTask) {
  return task.kind === 'percentage-line-control'
    && ACCEPTABLE_PERCENTAGE_LINE_ISSUES.has(task.issue)
}

export function getDispatcherTaskAcceptanceContext(task: DispatcherTask) {
  if (task.kind === 'welder-stamp-expiry') {
    return [
      `Клеймо: ${task.naksStamp}`,
      `Допуск: ${task.permitKind === 'dls' ? 'ДЛС' : 'НАКС'}`,
      `Действует до: ${task.validTo || 'без даты'}`,
    ].join(' · ')
  }
  if (task.kind === 'percentage-line-control') {
    return [
      task.projectTitle ? `Проект: ${task.projectTitle}` : '',
      task.subtitleCode ? `Шифр: ${task.subtitleCode}` : '',
      task.line ? `Линия: ${task.line}` : '',
      task.stamp ? `Клеймо: ${task.stamp}` : '',
    ].filter(Boolean).join(' · ')
  }
  if (task.kind === 'line-consistency') {
    return [
      task.projectTitle ? `Проект: ${task.projectTitle}` : '',
      task.subtitleCode ? `Шифр: ${task.subtitleCode}` : '',
      task.line ? `Линия: ${task.line}` : '',
      task.fieldLabel ? `Проверка: ${task.fieldLabel}` : '',
    ].filter(Boolean).join(' · ')
  }
  const row = task.row
  return [
    row.projectTitle ? `Проект: ${row.projectTitle}` : '',
    row.subtitleCode ? `Шифр: ${row.subtitleCode}` : '',
    row.line ? `Линия: ${row.line}` : '',
    row.joint ? `Стык: ${row.joint}` : '',
  ].filter(Boolean).join(' · ')
}

export function getDispatcherTaskAcceptanceTitle(task: DispatcherTask) {
  if ('title' in task) return task.title
  if (task.kind === 'welder-stamp-expiry') {
    return `Клеймо ${task.naksStamp}: срок ${task.permitKind === 'dls' ? 'ДЛС' : 'НАКС'}`
  }
  return task.kind
}
