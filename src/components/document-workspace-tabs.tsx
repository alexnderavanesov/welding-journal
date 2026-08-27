export type DocumentWorkspaceTab = 'joints' | 'documents'

type DocumentWorkspaceTabsProps = {
  activeTab: DocumentWorkspaceTab
  ariaLabel: string
  documentsLabel: string
  documentsCount: number
  documentsDisabled?: boolean
  documentsHaveError?: boolean
  onChange: (tab: DocumentWorkspaceTab) => void
}

export function DocumentWorkspaceTabs({
  activeTab,
  ariaLabel,
  documentsLabel,
  documentsCount,
  documentsDisabled = false,
  documentsHaveError = false,
  onChange,
}: DocumentWorkspaceTabsProps) {
  return (
    <div
      className="flex shrink-0 items-end gap-1 border-b border-slate-200 bg-white px-5 pt-1"
      role="tablist"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'joints'}
        onClick={() => onChange('joints')}
        className={`h-9 border-b-2 px-3 text-sm font-semibold transition-colors ${
          activeTab === 'joints'
            ? 'border-sky-600 text-sky-800'
            : 'border-transparent text-slate-500 hover:text-slate-800'
        }`}
      >
        Стыки
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'documents'}
        onClick={() => onChange('documents')}
        disabled={documentsDisabled}
        className={`inline-flex h-9 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors ${
          activeTab === 'documents'
            ? 'border-sky-600 text-sky-800'
            : 'border-transparent text-slate-500 hover:text-slate-800'
        } disabled:cursor-not-allowed disabled:text-slate-300`}
      >
        {documentsLabel}
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${
          documentsHaveError
            ? 'bg-rose-100 text-rose-700'
            : activeTab === 'documents'
              ? 'bg-sky-100 text-sky-800'
              : 'bg-slate-100 text-slate-500'
        }`}>
          {documentsCount}
        </span>
      </button>
    </div>
  )
}
