import { useEffect, useState } from 'react'
import { GitFork, LoaderCircle, RotateCcw, X } from 'lucide-react'

import { DialogCloseFooter } from '@/components/dialog-close-footer'
import { DialogInlineEmptyState } from '@/components/dialog-inline-empty-state'
import { JointChainCard } from '@/components/joint-chain-card'
import { JointHistoryOverview } from '@/components/joint-history-overview'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import type {
  RepeatedJointCreateTask,
  RepeatedJointRenameTask,
  RepeatedJointTask,
  WeldRow,
} from '@/lib/dispatcher-types'
import { getJointChainSubtitle } from '@/lib/joint-display'
import {
  getJointBranchRows,
  getJointCoilRelations,
  type JointCoilTransition,
} from '@/lib/joint-chain-transitions'
import type { JointNextAction } from '@/lib/joint-next-actions'
import type { WeldFieldKey } from '@/lib/weld-fields'
import type { WeldJointChainEarlyCoilCandidate } from '@/server/weld-contracts'

type JointChainDialogProps = {
  record: WeldRow
  rows: WeldRow[]
  transitions: JointCoilTransition[]
  earlyCoilCandidates: WeldJointChainEarlyCoilCandidate[]
  dispatcherTasks: RepeatedJointTask[]
  errorMessage: string | null
  isLoading: boolean
  onClose: () => void
  onOpenBase: (row: WeldRow) => void
  onOpenRow: (row: WeldRow) => void
  onOpenDocument: (row: WeldRow, fieldKey: WeldFieldKey) => void
  onOpenReport: (row: WeldRow, report: 'weldingJournal' | 'lnk' | 'heatTreatment') => void
  onRunNextAction: (row: WeldRow, action: JointNextAction) => void
  canCreateRepeatedJoint: boolean
  isRepeatedJointPending: boolean
  onCreateRepeatedJoint: (task: RepeatedJointCreateTask) => void
  canRenameRepeatedJoint: boolean
  isRenameRepeatedJointPending: boolean
  onRenameRepeatedJoint: (task: RepeatedJointRenameTask) => void
  canCreateEarlyCoil: boolean
  isEarlyCoilPending: boolean
  onCreateEarlyCoil: (row: WeldRow, candidate: WeldJointChainEarlyCoilCandidate) => void
  onRetry: () => void
}

export function JointChainDialog({
  record,
  rows,
  transitions,
  earlyCoilCandidates,
  dispatcherTasks,
  errorMessage,
  isLoading,
  onClose,
  onOpenBase,
  onOpenRow,
  onOpenDocument,
  onOpenReport,
  onRunNextAction,
  canCreateRepeatedJoint,
  isRepeatedJointPending,
  onCreateRepeatedJoint,
  canRenameRepeatedJoint,
  isRenameRepeatedJointPending,
  onRenameRepeatedJoint,
  canCreateEarlyCoil,
  isEarlyCoilPending,
  onCreateEarlyCoil,
  onRetry,
}: JointChainDialogProps) {
  const [selectedRowId, setSelectedRowId] = useState(record.id)
  const selectedRow = rows.find((row) => row.id === selectedRowId)
    ?? rows.find((row) => row.id === record.id)
    ?? rows[0]
    ?? record
  const branchRows = getJointBranchRows(rows, selectedRow)
  const relations = getJointCoilRelations(selectedRow, rows, transitions)
  const branchRowIds = new Set(branchRows.map((row) => row.id))
  const repeatedJointCreateTasks = dispatcherTasks.filter(
    (task): task is RepeatedJointCreateTask => task.kind === 'create' && branchRowIds.has(task.row.id),
  )
  const repeatedJointRenameTasks = dispatcherTasks.filter(
    (task): task is RepeatedJointRenameTask => task.kind === 'rename' && branchRowIds.has(task.row.id),
  )
  const earlyCoilCandidate = earlyCoilCandidates.find((candidate) =>
    branchRowIds.has(candidate.sourceRowId),
  ) ?? null

  useEffect(() => {
    setSelectedRowId(record.id)
  }, [record.id])

  return (
    <LargeDialogShell
      maxWidthClassName="max-w-[1180px]"
      maxHeightClassName="h-full max-h-none"
      overlayClassName="z-[70] bg-slate-950/25 !items-stretch !justify-end !px-0 !py-0"
      panelRadiusClassName="rounded-l-lg rounded-r-none"
      panelShadowClassName="shadow-[-18px_0_45px_-20px_rgba(15,23,42,0.35)]"
      panelClassName="ml-auto !h-full !max-h-none border-y-0 border-r-0"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Картина стыка {String(selectedRow.joint ?? '-')}</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenBase(selectedRow)}
              className="h-7 border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
            >
              Показать цепочку в отчете
            </Button>
          </div>
          <p className="mt-1 text-sm text-slate-500">{getJointChainSubtitle(selectedRow)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть цепочку стыка">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <DialogInlineEmptyState>
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Загружаем историю и цепочку стыка...
              </span>
            </DialogInlineEmptyState>
          </div>
        ) : errorMessage ? (
          <div className="p-5">
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-5 text-center">
              <p className="text-sm font-medium text-rose-800">Не удалось загрузить историю и цепочку стыка.</p>
              <p className="mt-1 text-xs text-rose-700">{errorMessage}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-2 bg-white" onClick={onRetry}>
                <RotateCcw className="h-4 w-4" />
                Повторить
              </Button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <DialogInlineEmptyState>По этому стыку история не найдена.</DialogInlineEmptyState>
          </div>
        ) : (
          <div className="grid h-full min-h-0 lg:grid-cols-[380px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col overflow-y-auto border-b border-slate-200 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Цепочка ремонта и выреза</div>
                <div className="space-y-2">
                  {branchRows.map((row, index) => (
                    <JointChainCard
                      key={row.id}
                      row={row}
                      index={index}
                      isCurrent={row.id === selectedRow.id}
                      onOpenRow={onOpenRow}
                      onSelect={(nextRow) => setSelectedRowId(nextRow.id)}
                    />
                  ))}
                </div>
                {relations.outgoing?.targetRowIds.some(Boolean) ? (
                  <CoilContinuationPanel
                    transition={relations.outgoing}
                    rows={rows}
                    onSelect={(row) => setSelectedRowId(row.id)}
                  />
                ) : null}
                {(canCreateRepeatedJoint && repeatedJointCreateTasks.length > 0) ||
                (canRenameRepeatedJoint && repeatedJointRenameTasks.length > 0) ||
                (canCreateEarlyCoil && earlyCoilCandidate) ? (
                  <ChainContinuationActionsPanel
                    repeatedJointTasks={canCreateRepeatedJoint ? repeatedJointCreateTasks : []}
                    repeatedJointRenameTasks={canRenameRepeatedJoint ? repeatedJointRenameTasks : []}
                    earlyCoilCandidate={canCreateEarlyCoil ? earlyCoilCandidate : null}
                    rows={rows}
                    isRepeatedJointPending={isRepeatedJointPending}
                    isRenameRepeatedJointPending={isRenameRepeatedJointPending}
                    isEarlyCoilPending={isEarlyCoilPending}
                    onCreateRepeatedJoint={onCreateRepeatedJoint}
                    onRenameRepeatedJoint={onRenameRepeatedJoint}
                    onCreateEarlyCoil={onCreateEarlyCoil}
                  />
                ) : null}
              </div>
              <JointBranchRelations
                relations={relations}
                onSelect={(row) => setSelectedRowId(row.id)}
              />
            </aside>
            <main className="min-h-0 overflow-y-auto px-5 py-4">
              <JointHistoryOverview
                row={selectedRow}
                dispatcherTasks={dispatcherTasks}
                onOpenDocument={onOpenDocument}
                onOpenReport={onOpenReport}
                onRunNextAction={onRunNextAction}
              />
            </main>
          </div>
        )}
      </div>

      <DialogCloseFooter onClose={onClose} borderClassName="border-slate-200" />
    </LargeDialogShell>
  )
}

function CoilContinuationPanel({
  transition,
  rows,
  onSelect,
}: {
  transition: JointCoilTransition
  rows: WeldRow[]
  onSelect: (row: WeldRow) => void
}) {
  const targetRows = transition.targetRowIds.map((rowId) =>
    rowId ? rows.find((row) => row.id === rowId) ?? null : null,
  )
  return (
    <section className="mt-4 border-t border-sky-200 pt-4" aria-label="Продолжение цепочки катушкой">
      <div className="flex items-start gap-2.5">
        <GitFork className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Стык превратился в катушку</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            После {transition.sourceJoint || transition.parentBranchJoint} созданы две новые ветки
            {transition.mode === 'early-decision' ? ' по принятому досрочному решению' : ''}.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {transition.targetJoints.map((joint, index) => {
          const row = targetRows[index]
          return (
            <Button
              key={joint}
              type="button"
              size="sm"
              variant="outline"
              className="h-8 min-w-0 border-sky-200 bg-white px-2 text-xs font-semibold text-sky-800 hover:bg-sky-50"
              disabled={!row}
              onClick={() => row && onSelect(row)}
            >
              <span className="truncate">{joint}</span>
            </Button>
          )
        })}
      </div>
    </section>
  )
}

function ChainContinuationActionsPanel({
  repeatedJointTasks,
  repeatedJointRenameTasks,
  earlyCoilCandidate,
  rows,
  isRepeatedJointPending,
  isRenameRepeatedJointPending,
  isEarlyCoilPending,
  onCreateRepeatedJoint,
  onRenameRepeatedJoint,
  onCreateEarlyCoil,
}: {
  repeatedJointTasks: RepeatedJointCreateTask[]
  repeatedJointRenameTasks: RepeatedJointRenameTask[]
  earlyCoilCandidate: WeldJointChainEarlyCoilCandidate | null
  rows: WeldRow[]
  isRepeatedJointPending: boolean
  isRenameRepeatedJointPending: boolean
  isEarlyCoilPending: boolean
  onCreateRepeatedJoint: (task: RepeatedJointCreateTask) => void
  onRenameRepeatedJoint: (task: RepeatedJointRenameTask) => void
  onCreateEarlyCoil: (row: WeldRow, candidate: WeldJointChainEarlyCoilCandidate) => void
}) {
  const earlyCoilSourceRow = earlyCoilCandidate
    ? rows.find((row) => row.id === earlyCoilCandidate.sourceRowId) ?? null
    : null
  const hasRepeatedJointAction = repeatedJointTasks.length > 0
  const hasRenameAction = repeatedJointRenameTasks.length > 0
  const hasEarlyCoilAction = Boolean(earlyCoilCandidate && earlyCoilSourceRow)
  const replacementJoint = earlyCoilCandidate?.replacementJoint ?? null
  if (!hasRepeatedJointAction && !hasRenameAction && !hasEarlyCoilAction) return null
  const title = hasRenameAction
    ? 'Исправить имена цепочки'
    : hasRepeatedJointAction && hasEarlyCoilAction
    ? 'Выберите продолжение цепочки'
    : hasRepeatedJointAction
      ? 'Продолжить цепочку'
      : replacementJoint
        ? `Заменить пустой ${replacementJoint} на катушку`
        : 'Нужна катушка до лимита ремонтов'
  return (
    <section className="mt-4 border-t border-amber-200 pt-4" aria-label="Продолжение цепочки стыка">
      <div className="flex items-start gap-2.5">
        <GitFork className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {hasRenameAction
              ? 'Диспетчер повторно прошел фактические результаты: порядок R/W отражает их историю, а номера каждого вида пересчитаны заново.'
              : hasRepeatedJointAction && hasEarlyCoilAction
              ? `Можно продолжить цепочку по счетчику либо завершить ветку ${earlyCoilCandidate!.sourceJoint} катушкой.`
              : hasRepeatedJointAction
                ? 'Диспетчер подтвердил допустимое продолжение цепочки.'
                : replacementJoint
                  ? `Будут созданы ${earlyCoilCandidate!.targetJoints.join(' и ')} по негодному результату ${earlyCoilCandidate!.sourceJoint}.`
                  : `Можно завершить ветку ${earlyCoilCandidate!.sourceJoint} и создать ${earlyCoilCandidate!.targetJoints.join(' + ')}.`}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {repeatedJointRenameTasks.map((task) => (
          <Button
            key={task.key}
            type="button"
            size="sm"
            variant="outline"
            className="h-auto min-h-8 w-full whitespace-normal border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            disabled={isRenameRepeatedJointPending}
            onClick={() => onRenameRepeatedJoint(task)}
          >
            Переименовать {task.currentJoint} -&gt; {task.targetJoint}
            {task.changes.length > 1 ? ` (+${task.changes.length - 1} далее)` : ''}
          </Button>
        ))}
        {repeatedJointTasks.map((task) => (
          <Button
            key={task.key}
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full border-sky-300 bg-sky-50 text-xs font-semibold text-sky-900 hover:bg-sky-100"
            disabled={isRepeatedJointPending}
            onClick={() => onCreateRepeatedJoint(task)}
          >
            Создать {task.targetJoint}
          </Button>
        ))}
        {earlyCoilCandidate && earlyCoilSourceRow ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full border-amber-300 bg-amber-50 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            disabled={isEarlyCoilPending}
            onClick={() => onCreateEarlyCoil(earlyCoilSourceRow, earlyCoilCandidate)}
          >
            Врезать катушку досрочно
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function JointBranchRelations({
  relations,
  onSelect,
}: {
  relations: ReturnType<typeof getJointCoilRelations>
  onSelect: (row: WeldRow) => void
}) {
  if (!relations.incoming) return null
  const sourceRow = relations.sourceRow
  const siblingRow = relations.siblingRow
  const currentJoint = String(relations.currentBranchRoot?.joint ?? relations.branchJoint).trim()
  return (
    <section className="mt-auto border-t border-sky-200 bg-sky-50/60 px-3.5 py-3" aria-label="Связи стыка катушки">
      <div className="flex items-start gap-2.5">
        <GitFork className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{currentJoint} является стыком катушки</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Предыдущий стык: {relations.incoming.sourceJoint || relations.incoming.parentBranchJoint}.
            {relations.siblingJoint ? ` Парный стык: ${relations.siblingJoint}.` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {sourceRow ? (
              <RelationButton label={`Предыдущий: ${String(sourceRow.joint ?? '-')}`} onClick={() => onSelect(sourceRow)} />
            ) : null}
            {siblingRow ? (
              <RelationButton label={`Парный: ${relations.siblingJoint}`} onClick={() => onSelect(siblingRow)} />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function RelationButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 border-sky-200 bg-white px-2.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
      onClick={onClick}
    >
      {label}
    </Button>
  )
}
