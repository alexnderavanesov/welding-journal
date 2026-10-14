import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { FieldHelp } from '@/components/field-help'
import { LnkResultManagerDialog } from '@/components/lnk-result-manager-dialog'
import { PreHeatTreatmentResultManagerDialog } from '@/components/pre-heat-treatment-result-manager-dialog'
import type { PreHeatTreatmentResultEditDraft } from '@/lib/lnk-result-edit-plan'
import type { WeldRow } from '@/lib/dispatcher-types'
import type { WeldFieldKey } from '@/lib/weld-fields'
import { LNK_METHODS } from '@/lib/lnk-report-config'
import { HeatTreatmentHeaderActions, LnkHeaderActions } from '@/components/report-header-action-groups'
import { useCancelPendingWorkflowAction, WorkflowActionMenuItem, WorkflowActionScope, type WorkflowAvailability } from '@/components/workflow-action-menu-item'
import { WORK_GUIDE_SECTIONS } from '@/components/user-guide-content/work-sections'
import { useReportModalEscapeKey } from '@/lib/use-report-modal-escape-key'
import { useWorkflowRootCauseEscapeKey } from '@/lib/use-workflow-root-cause-escape-key'

// Acceptance source: document-required-names-plan-2026-10-11.md, menu context
// cancellation; user requirement: the first Escape dismisses only the tooltip.
// Pure DOM regressions: no server modules, RPC, fixtures, or database access.
describe('precommit workflow interaction audit', () => {
  function header(availability: WorkflowAvailability, actions: {
    onAddResult: () => void
    onOpenOfficiality: () => void
    onOpenDuplicateControl: () => void
    onWorkflowMenuOpenChange?: (open: boolean) => void
  }) {
    return <WorkflowActionScope>
      <LnkHeaderActions
        onCreateRequest={vi.fn()}
        onExtendRequest={vi.fn()}
        onOpenRequestRegistry={vi.fn()}
        requestPending={false}
        onAddResult={actions.onAddResult}
        resultDisabled={false}
        onEditSelectedResults={vi.fn()}
        editSelectedResultsDisabled
        onOpenResultRegistry={vi.fn()}
        resultRegistryDisabled={false}
        onOpenOfficiality={actions.onOpenOfficiality}
        officialityPending={false}
        onOpenDuplicateControl={actions.onOpenDuplicateControl}
        duplicateControlPending={false}
        isShowMenuOpen={false}
        onToggleShowMenu={vi.fn()}
        onOpenCurrentReport={vi.fn()}
        onOpenToRequestReport={vi.fn()}
        onOpenWaitingNkReport={vi.fn()}
        onOpenConclusionsReport={vi.fn()}
        availability={availability}
        onWorkflowMenuOpenChange={actions.onWorkflowMenuOpenChange}
      />
    </WorkflowActionScope>
  }

  it.each([
    ['Официальность', 'pointer'], ['Дубль контроль', 'pointer'],
    ['Официальность', 'keyboard'], ['Дубль контроль', 'keyboard'],
  ])('cancels a queued result when the operator opens %s via %s', (nextAction, input) => {
    const actions = { onAddResult: vi.fn(), onOpenOfficiality: vi.fn(), onOpenDuplicateControl: vi.fn(), onWorkflowMenuOpenChange: vi.fn() }
    const view = render(header('loading', actions))
    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    expect(actions.onAddResult).not.toHaveBeenCalled()

    const alternative = screen.getByRole('button', { name: nextAction })
    // Keyboard activation emits click without pointerdown.
    if (input === 'pointer') fireEvent.pointerDown(alternative)
    fireEvent.click(alternative)
    expect(nextAction === 'Официальность' ? actions.onOpenOfficiality : actions.onOpenDuplicateControl).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Внести результаты' })).not.toBeInTheDocument()
    expect(actions.onWorkflowMenuOpenChange).toHaveBeenLastCalledWith(false)
    expect(actions.onWorkflowMenuOpenChange.mock.calls).toEqual([[true], [false]])
    view.rerender(header('ready', actions))

    expect(actions.onAddResult).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    expect(actions.onAddResult).toHaveBeenCalledOnce()
  })

  it('cancels a queued result when the operator explicitly closes its menu', () => {
    const actions = { onAddResult: vi.fn(), onOpenOfficiality: vi.fn(), onOpenDuplicateControl: vi.fn() }
    const view = render(header('loading', actions))
    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    view.rerender(header('ready', actions))
    expect(actions.onAddResult).not.toHaveBeenCalled()
  })

  const dialogFlags = [
    'isLnkRequestModalOpen', 'isLnkResultModalOpen', 'isLnkOfficialityModalOpen', 'isDuplicateControlModalOpen',
    'isLnkRequestManagerOpen', 'isLnkResultManagerOpen',
    'isPstoRequestModalOpen', 'isPstoResultModalOpen', 'isPstoRequestManagerOpen', 'isPstoResultManagerOpen',
    'isPreHeatTreatmentWorkflowOpen', 'isPreHeatTreatmentResultManagerOpen',
    'isTvmtWorkflowOpen', 'isPstoRepeatWorkflowOpen', 'isPstoLineProgramOpen',
    'isRkExposureModalOpen', 'isReportImportModalOpen', 'isDispatcherWorkspaceOpen',
  ] as const

  function HelpInDialog({ onClose, href, dialog = 'isLnkResultModalOpen' }: {
    onClose: () => void; href?: string; dialog?: typeof dialogFlags[number]
  }) {
    useReportModalEscapeKey({
      isReportModalOpen: true,
      isPstoRequestManagerOpen: false,
      isPstoResultManagerOpen: false,
      isLnkRequestManagerOpen: false,
      isLnkResultManagerOpen: false,
      isRkExposureModalOpen: false,
      isPstoResultModalOpen: false,
      isPstoRequestModalOpen: false,
      isLnkOfficialityModalOpen: false,
      isLnkResultModalOpen: false,
      isLnkRequestModalOpen: false,
      isReportImportModalOpen: false,
      canClosePstoRequestManager: true,
      canClosePstoResultManager: true,
      canCloseLnkRequestManager: true,
      canCloseLnkResultManager: true,
      canCloseRkExposureModal: true,
      onClosePstoRequestManager: onClose,
      onClosePstoResultManager: onClose,
      onCloseLnkRequestManager: onClose,
      onCloseLnkResultManager: onClose,
      onCloseRkExposureModal: onClose,
      onClosePstoResultModal: onClose,
      onClosePstoRequestModal: onClose,
      onCloseLnkOfficialityModal: onClose,
      onCloseLnkResultModal: onClose,
      onCloseLnkRequestModal: onClose,
      onCloseReportImportModal: onClose,
      onClosePreHeatTreatmentWorkflow: onClose,
      onClosePreHeatTreatmentResultManager: onClose,
      onCloseTvmtWorkflow: onClose,
      onClosePstoRepeatWorkflow: onClose,
      onClosePstoLineProgram: onClose,
      onCloseDuplicateControlModal: onClose,
      onCloseDispatcherWorkspace: onClose,
      [dialog]: true,
    })
    return <FieldHelp label="Как работает разделение документов" href={href}>Описание правила</FieldHelp>
  }

  it.each(dialogFlags)('dismisses ordinary help before %s', dialog => {
    const onClose = vi.fn()
    render(<HelpInDialog onClose={onClose} dialog={dialog} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Как работает разделение документов' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each([
    { href: undefined, activation: 'focus' }, { href: undefined, activation: 'pin' },
    { href: '/user-guide#rule-sp-07', activation: 'hover' },
    { href: '/user-guide#rule-sp-07', activation: 'focus' },
  ])('dismisses help before the draft: $activation, href=$href', ({ href, activation }) => {
    const onClose = vi.fn()
    render(<HelpInDialog onClose={onClose} href={href} />)
    const trigger = screen.getByRole(href ? 'link' : 'button', { name: 'Как работает разделение документов' })
    if (href) {
      expect(trigger).toHaveAttribute('href', href)
      expect(trigger).toHaveAttribute('target', '_blank')
    }
    if (activation === 'focus') fireEvent.focus(trigger)
    else if (activation === 'pin') { fireEvent.click(trigger); fireEvent.mouseLeave(trigger) }
    else fireEvent.mouseEnter(trigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Описание правила')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not return from root-cause editing while dismissing help', () => {
    const onReturn = vi.fn()
    function RootCauseEditor() {
      useWorkflowRootCauseEscapeKey({ active: true, onReturn })
      return <FieldHelp label="Подсказка">Правило</FieldHelp>
    }
    render(<RootCauseEditor />)
    fireEvent.click(screen.getByRole('button', { name: 'Подсказка' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onReturn).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onReturn).toHaveBeenCalledOnce()
  })

  const pendingEntries = [
    ['Заявка', 'Новая заявка'], ['Результат', 'Внести результаты'],
    ['ТВМТ', 'Новая заявка ТВМТ'], ['ТВМТ', 'Внести результаты ТВМТ'],
  ] as const

  function heatHeader(availability: WorkflowAvailability, onPending: () => void, onAlternative: () => void, onContext: (open: boolean) => void) {
    return <WorkflowActionScope><HeatTreatmentHeaderActions
      onOpenLineProgram={onAlternative}
      onCreateRequest={onPending} createRequestDisabled={false}
      onEditSelectedRequest={onAlternative} editSelectedRequestDisabled={false}
      onOpenRequestRegistry={onAlternative} requestPending={false}
      onAddResult={onPending} resultDisabled={false}
      onEditSelectedResults={onAlternative} editSelectedResultsDisabled={false}
      onOpenResultRegistry={onAlternative} resultRegistryDisabled={false}
      onCreateTvmtRequest={onPending} createTvmtRequestDisabled={false}
      onAddTvmtResult={onPending} addTvmtResultDisabled={false} tvmtPending={false}
      isShowMenuOpen={false} onToggleShowMenu={onAlternative}
      onOpenCurrentReport={onAlternative} onOpenWaitingRequestReport={onAlternative} onOpenResultsReport={onAlternative}
      availability={availability} onWorkflowMenuOpenChange={onContext}
    /></WorkflowActionScope>
  }

  it.each(pendingEntries)('cancels %s / %s before opening the line program', (menu, entry) => {
    const onPending = vi.fn(), onAlternative = vi.fn(), onContext = vi.fn()
    const view = render(heatHeader('loading', onPending, onAlternative, onContext))
    fireEvent.click(screen.getByRole('button', { name: menu }))
    fireEvent.click(screen.getByRole('button', { name: entry }))
    fireEvent.click(screen.getByRole('button', { name: 'Программа ПСТО' }))
    expect(onAlternative).toHaveBeenCalledOnce()
    expect(onContext).toHaveBeenLastCalledWith(false)
    view.rerender(heatHeader('ready', onPending, onAlternative, onContext))
    expect(onPending).not.toHaveBeenCalled()
  })

  it.each(['Показать', 'Заявка', 'ТВМТ', 'Редактировать выбранные', 'Escape', 'outside-pointer', 'outside-click'])('cancels PSTO result when leaving through %s', alternative => {
    const onPending = vi.fn(), onAlternative = vi.fn(), onContext = vi.fn()
    const view = render(heatHeader('loading', onPending, onAlternative, onContext))
    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    if (alternative === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
    else if (alternative === 'outside-pointer') fireEvent.pointerDown(document.body)
    else if (alternative === 'outside-click') fireEvent.click(document.body)
    else fireEvent.click(screen.getByRole('button', { name: alternative }))
    view.rerender(heatHeader('ready', onPending, onAlternative, onContext))
    expect(onPending).not.toHaveBeenCalled()
  })

  it('cancels before an alternative entry synchronously resolves availability', () => {
    const onPending = vi.fn(), onAlternative = vi.fn()
    function Harness() {
      const [availability, setAvailability] = useState<WorkflowAvailability>('loading')
      return header(availability, {
        onAddResult: onPending,
        onOpenOfficiality: () => { onAlternative(); setAvailability('ready') },
        onOpenDuplicateControl: vi.fn(),
      })
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    fireEvent.click(screen.getByRole('button', { name: 'Официальность' }))
    expect(onAlternative).toHaveBeenCalledOnce()
    expect(onPending).not.toHaveBeenCalled()
  })

  it.each(['lnk', 'psto'])('cancels %s when focus leaves for a keyboard entry outside the header', domain => {
    const onPending = vi.fn(), onAlternative = vi.fn(), onContext = vi.fn()
    const content = (availability: WorkflowAvailability) => <>
      {domain === 'lnk' ? header(availability, {
        onAddResult: onPending, onOpenOfficiality: onAlternative, onOpenDuplicateControl: onAlternative,
        onWorkflowMenuOpenChange: onContext,
      }) : heatHeader(availability, onPending, onAlternative, onContext)}
      <button onClick={onAlternative}>Другой вход</button>
    </>
    const view = render(content('loading'))
    fireEvent.click(screen.getByRole('button', { name: 'Результат' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты' }))
    fireEvent.focusIn(screen.getByRole('button', { name: 'Другой вход' }))
    expect(screen.queryByRole('button', { name: 'Внести результаты' })).not.toBeInTheDocument()
    expect(onContext.mock.calls).toEqual([[true], [false]])
    view.rerender(content('ready'))
    expect(onPending).not.toHaveBeenCalled()
  })

  it('dismisses before an outside entry that stops pointer propagation', () => {
    const onPending = vi.fn(), onAlternative = vi.fn(), onContext = vi.fn()
    const content = (availability: WorkflowAvailability) => <>
      {heatHeader(availability, onPending, onAlternative, onContext)}
      <button onPointerDown={event => { event.stopPropagation(); onAlternative() }}>Другой вход</button>
    </>
    const view = render(content('loading'))
    fireEvent.click(screen.getByRole('button', { name: 'ТВМТ' }))
    fireEvent.click(screen.getByRole('button', { name: 'Внести результаты ТВМТ' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Другой вход' }))
    expect(onAlternative).toHaveBeenCalledOnce()
    expect(onContext.mock.calls).toEqual([[true], [false]])
    view.rerender(content('ready'))
    expect(onPending).not.toHaveBeenCalled()
  })

  it('invalidates the pending token before unmount, not only in effect cleanup', () => {
    const onPending = vi.fn()
    function Actions() {
      const cancel = useCancelPendingWorkflowAction()
      const [availability, setAvailability] = useState<WorkflowAvailability>('loading')
      return <>
        <WorkflowActionMenuItem label="Ожидающее действие" icon={Plus} availability={availability} onClick={onPending} />
        <button onClick={() => { cancel(); setAvailability('ready') }}>Другой вход</button>
      </>
    }
    render(<WorkflowActionScope><Actions /></WorkflowActionScope>)
    fireEvent.click(screen.getByRole('button', { name: 'Ожидающее действие' }))
    fireEvent.click(screen.getByRole('button', { name: 'Другой вход' }))
    expect(screen.getByRole('button', { name: 'Ожидающее действие' })).toBeEnabled()
    expect(onPending).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ожидающее действие' }))
    expect(onPending).toHaveBeenCalledOnce()
  })

  it('documents waiting and cancellation consistently, without the old disabled-loading rule', () => {
    const content = JSON.stringify(WORK_GUIDE_SECTIONS)
    expect(content).not.toContain('До завершения проверки нельзя нажать проверяемое действие')
    expect(content).not.toContain('проверка доступности показана отдельной подписью')
    expect(content).toContain('переход к другому действию отменяет ожидание')
    expect(content).toContain('первый Escape закрывает только её')
  })
})

describe('staged result editor presentation', () => {
  const method = LNK_METHODS.find(method => method.code === 'ВИК')!
  const rows = [1, 2].map(id => ({
    id, rowVersion: `v${id}`, projectTitle: 'Проект', subtitleCode: 'Шифр', line: 'L', joint: `S${id}`,
    vikRequest: `З-${id}`, vikRequestDate: '2026-08-03', vikResult: id === 1 ? 'ремонт' : 'годен',
    vikConclusion: `К-${id}`, vikConclusionDate: '2026-08-04',
    preHeatTreatmentControls: [{ id: 100 + id, weldJointId: id, method: 'ВИК',
      requestName: `З-${id}`, requestDate: '2026-08-03', result: id === 1 ? 'ремонт' : 'годен',
      conclusionName: `К-${id}`, conclusionDate: '2026-08-04' }],
  })) as WeldRow[]

  function Editor({ domain, onSave, onClose, onCorrect }: {
    domain: 'primary' | 'preTO'; onSave: () => void; onClose: () => void; onCorrect: (...args: unknown[]) => void
  }) {
    const [primary, setPrimary] = useState<Record<string, string | null>>({})
    const [pre, setPre] = useState<Record<string, PreHeatTreatmentResultEditDraft | null>>({})
    const [methodKey, setMethodKey] = useState<WeldFieldKey | ''>('')
    const entries = rows.map(row => ({ row, method, changeKey: `${row.id}:${method.requestKey}` }))
    const common = { rows, onClose, onOpenJournalRows: vi.fn(), onOpenDocument: vi.fn(), onCopyDocumentName: vi.fn(), canOpenDocument: () => true }
    return domain === 'primary' ? <LnkResultManagerDialog {...common}
      methods={[...LNK_METHODS]} entries={entries.filter(entry => !methodKey || entry.method.requestKey === methodKey)} pendingEntries={[]}
      isContextReady methodKey={methodKey} initialEntryKey="1:vikRequest" conclusionDrafts={{}}
      pendingResultChanges={primary} changeHint={null}
      isResultReplacementPending={false} isConclusionCorrectionPending={false}
      onOpenAddResult={vi.fn()} onOpenRows={vi.fn()} onMethodChange={setMethodKey}
      onConclusionDraftChange={vi.fn()} onRenameConclusion={onCorrect}
      onReplaceResult={(row, key, value) => setPrimary(current => ({ ...current, [`${row.id}:${key}`]: value }))}
      onClearResult={(row, key) => setPrimary(current => ({ ...current, [`${row.id}:${key}`]: null }))}
      onResetPendingChanges={() => setPrimary({})} onSaveChanges={onSave}
    /> : <PreHeatTreatmentResultManagerDialog {...common}
      registryMode="result" isPending={false} pendingResultChanges={pre} pendingResultCount={Object.keys(pre).length}
      onStageResultChange={(_row, control, patch) => setPre(current => ({ ...current, [String(control.id)]: patch }))}
      onResetChanges={() => setPre({})} onSaveChanges={onSave} onCorrect={onCorrect}
      onDeleteRequest={vi.fn()} onOpenWorkflow={vi.fn()}
    />
  }

  it.each(['primary', 'preTO'] as const)('%s keeps factual rows, all hidden choices and an open editor after reset', domain => {
    const onSave = vi.fn(), onClose = vi.fn(), onCorrect = vi.fn()
    render(<Editor domain={domain} onSave={onSave} onClose={onClose} onCorrect={onCorrect} />)
    const pickerLabel = domain === 'primary' ? 'Изменить на:' : 'Результат'
    const picker = screen.getByRole('group', { name: pickerLabel })
    fireEvent.click(within(picker).getByRole('button', { name: 'годен' }))
    expect(screen.getByText('Подготовлено изменений: 1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /L · S2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить результат' }))
    const factualRow = screen.getByRole('button', { name: /L · S2/ })
    expect(factualRow).toHaveTextContent('годен')
    expect(factualRow).toHaveTextContent('К-2')
    expect(factualRow).toHaveTextContent('Будет удалён')
    expect(screen.getByText('Подготовлено изменений: 2')).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
    expect(onCorrect).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Вид контроля в реестре' }), {
      target: { value: domain === 'primary' ? 'rkRequest' : 'РК' },
    })
    expect(screen.queryByRole('button', { name: /L · S2/ })).not.toBeInTheDocument()
    expect(screen.getByText('Подготовлено изменений: 2')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    expect(onSave).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить изменения' }))
    expect(screen.queryByText('Подготовлено изменений: 2')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Вид контроля в реестре' }), { target: { value: '' } })
    expect(screen.getByRole('button', { name: /L · S2/ })).not.toHaveTextContent('Будет удалён')
    expect(screen.getByRole('button', { name: /L · S1/ })).toHaveTextContent('ремонт')
  })

  it('preTO retains separately edited document text across selection without including it in the result save', () => {
    const onCorrect = vi.fn(), onSave = vi.fn()
    render(<Editor domain="preTO" onSave={onSave} onClose={vi.fn()} onCorrect={onCorrect} />)
    fireEvent.change(screen.getByLabelText('Наименование заключения'), { target: { value: 'Неприменённое имя' } })
    fireEvent.click(screen.getByRole('button', { name: /L · S2/ }))
    fireEvent.click(screen.getByRole('button', { name: /L · S1/ }))
    expect(screen.getByLabelText('Наименование заключения')).toHaveValue('Неприменённое имя')
    fireEvent.click(screen.getByRole('button', { name: 'Удалить результат' }))
    expect(screen.getByRole('button', { name: 'Сохранить реквизиты' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onCorrect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Отменить изменения' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить реквизиты' }))
    expect(onCorrect).toHaveBeenCalledWith(expect.objectContaining({ result: 'ремонт', conclusionName: 'Неприменённое имя' }))
  })
})
