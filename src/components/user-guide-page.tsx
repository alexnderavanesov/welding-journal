import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenText,
  Download,
  Info,
  LoaderCircle,
  RefreshCw,
  Route,
  Search,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { WORK_GUIDE_SECTIONS } from '@/components/user-guide-content/work-sections'
import type { GuideBlock, GuideSection } from '@/components/user-guide-content/types'

const USER_GUIDE_PDF_TITLE = 'Руководство пользователя. Учет сварки'

let referenceGuideSectionsPromise: Promise<GuideSection[]> | null = null

function loadReferenceGuideSections() {
  if (!referenceGuideSectionsPromise) {
    referenceGuideSectionsPromise = Promise.all([
      import('@/components/user-guide-content/reference-sections-1'),
      import('@/components/user-guide-content/reference-sections-2'),
      import('@/components/user-guide-content/reference-sections-3'),
    ])
      .then((parts) => orderReferenceGuideSections(parts.flatMap((part) => part.REFERENCE_GUIDE_SECTIONS)))
      .catch((error) => {
        referenceGuideSectionsPromise = null
        throw error
      })
  }

  return referenceGuideSectionsPromise
}

function orderReferenceGuideSections(sections: GuideSection[]) {
  const orderedSections = [...sections]
  const settingsSectionIndex = orderedSections.findIndex((section) => section.id === 'settings')
  const ruleMatricesSectionIndex = orderedSections.findIndex((section) => section.id === 'rule-matrices')
  if (settingsSectionIndex !== -1 && ruleMatricesSectionIndex !== -1 && settingsSectionIndex < ruleMatricesSectionIndex) {
    ;[orderedSections[settingsSectionIndex], orderedSections[ruleMatricesSectionIndex]] = [
      orderedSections[ruleMatricesSectionIndex],
      orderedSections[settingsSectionIndex],
    ]
  }
  return orderedSections
}

type GuideMode = 'work' | 'reference'

export function UserGuidePage() {
  const [query, setQuery] = useState('')
  const [guideMode, setGuideMode] = useState<GuideMode>('work')
  const [referenceGuideSections, setReferenceGuideSections] = useState<GuideSection[] | null>(null)
  const [referenceGuideError, setReferenceGuideError] = useState<Error | null>(null)
  const [referenceLoadAttempt, setReferenceLoadAttempt] = useState(0)
  const [activeSectionId, setActiveSectionId] = useState(() => WORK_GUIDE_SECTIONS[0]?.id ?? '')
  const normalizedQuery = normalizeGuideText(query)
  const guideSections = guideMode === 'work' ? WORK_GUIDE_SECTIONS : referenceGuideSections ?? []
  const isReferenceGuideLoading = guideMode === 'reference' && referenceGuideSections === null && referenceGuideError === null
  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return guideSections
    return guideSections.filter((section) => getSectionSearchText(section).includes(normalizedQuery))
  }, [guideSections, normalizedQuery])

  const activeSection = filteredSections.find((section) => section.id === activeSectionId) ?? filteredSections[0]
  const activeSectionIndex = activeSection ? filteredSections.findIndex((section) => section.id === activeSection.id) : -1
  const previousSection = activeSectionIndex > 0 ? filteredSections[activeSectionIndex - 1] : null
  const nextSection = activeSectionIndex >= 0 && activeSectionIndex < filteredSections.length - 1 ? filteredSections[activeSectionIndex + 1] : null

  useEffect(() => {
    if (guideMode !== 'reference' || referenceGuideSections !== null) return

    let ignoreResult = false
    setReferenceGuideError(null)
    void loadReferenceGuideSections()
      .then((sections) => {
        if (!ignoreResult) setReferenceGuideSections(sections)
      })
      .catch((error: unknown) => {
        if (!ignoreResult) {
          setReferenceGuideError(error instanceof Error ? error : new Error('Не удалось загрузить полный справочник.'))
        }
      })

    return () => {
      ignoreResult = true
    }
  }, [guideMode, referenceGuideSections, referenceLoadAttempt])

  useEffect(() => {
    if (filteredSections.length === 0) {
      setActiveSectionId('')
      return
    }
    if (!filteredSections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(filteredSections[0].id)
    }
  }, [activeSectionId, filteredSections])

  function handleDownloadPdf() {
    const previousTitle = document.title
    const restoreTitle = () => {
      document.title = previousTitle
      window.removeEventListener('afterprint', restoreTitle)
    }

    document.title = USER_GUIDE_PDF_TITLE
    window.addEventListener('afterprint', restoreTitle)
    window.print()
    window.setTimeout(restoreTitle, 1000)
  }

  function selectMode(nextMode: GuideMode) {
    setGuideMode(nextMode)
    setQuery('')
    const nextSections = nextMode === 'work' ? WORK_GUIDE_SECTIONS : referenceGuideSections ?? []
    setActiveSectionId(nextSections[0]?.id ?? '')
  }

  function retryReferenceGuideLoad() {
    setReferenceGuideError(null)
    setReferenceLoadAttempt((attempt) => attempt + 1)
  }

  return (
    <div className="user-guide-page min-w-0 space-y-4 pb-8">
      <section className="rounded-md border border-slate-200 bg-white print:block print:max-h-none print:overflow-visible xl:flex xl:max-h-[calc(100vh-7rem)] xl:flex-col xl:overflow-hidden">
        <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-5 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-4xl">
              <div className="flex items-center gap-2">
                <BookOpenText className="h-5 w-5 text-slate-500" />
                <h2 className="text-xl font-semibold text-slate-950">Как работать в системе</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Выберите рабочую задачу слева и следуйте коротким шагам. Редкие ограничения и полные таблицы правил вынесены в отдельный справочник.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="inline-flex rounded-md border border-slate-200 bg-white p-1" aria-label="Вид руководства">
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                    guideMode === 'work' ? 'bg-sky-50 text-sky-800' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  onClick={() => selectMode('work')}
                  aria-pressed={guideMode === 'work'}
                >
                  Кратко
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                    guideMode === 'reference' ? 'bg-sky-50 text-sky-800' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  onClick={() => selectMode('reference')}
                  aria-pressed={guideMode === 'reference'}
                >
                  Все правила
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={handleDownloadPdf}
                disabled={isReferenceGuideLoading || referenceGuideError !== null}
              >
                <Download className="h-4 w-4" />
                PDF
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-4 print:block print:overflow-visible xl:min-h-0 xl:flex-1 xl:grid-cols-[290px_minmax(0,1fr)] xl:overflow-hidden">
          <aside className="self-start print:hidden xl:h-full xl:self-stretch xl:overflow-hidden">
            <div className="space-y-3 xl:flex xl:h-full xl:flex-col xl:overflow-hidden">
              <label className="grid gap-1 text-xs font-medium text-slate-600">
                Поиск по руководству
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Например: заявка, клеймо"
                    className="h-9 rounded-md border-slate-200 pl-9 text-sm"
                    disabled={isReferenceGuideLoading || referenceGuideError !== null}
                  />
                </div>
              </label>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
                {isReferenceGuideLoading
                  ? 'Загружаем полный справочник...'
                  : referenceGuideError
                    ? 'Не удалось загрузить полный справочник'
                    : normalizedQuery
                      ? `Найдено: ${filteredSections.length}`
                      : guideMode === 'work'
                        ? 'Ежедневные рабочие сценарии'
                        : 'Полный справочник правил'}
              </div>
              <nav className="max-h-[calc(100vh-12rem)] space-y-1 overflow-auto pr-1 xl:min-h-0 xl:max-h-none xl:flex-1">
                {filteredSections.map((section, index) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    onClick={(event) => {
                      event.preventDefault()
                      setActiveSectionId(section.id)
                    }}
                    aria-current={activeSectionId === section.id ? 'true' : undefined}
                    className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      activeSectionId === section.id
                        ? 'border border-sky-100 bg-sky-50 text-slate-900 shadow-sm shadow-sky-100/50'
                        : 'border border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                    }`}
                  >
                    <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-slate-400">{index + 1}</span>
                    <span>{section.title}</span>
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <div data-page-scroll-container className="min-w-0 space-y-4 print:h-auto print:overflow-visible print:pr-0 xl:h-full xl:overflow-y-auto xl:pr-2">
            {isReferenceGuideLoading ? (
              <GuideLoadingState />
            ) : referenceGuideError ? (
              <GuideLoadErrorState onRetry={retryReferenceGuideLoad} />
            ) : filteredSections.length > 0 ? (
              <>
                {filteredSections.map((section, index) => (
                  <div key={section.id} className={section.id === activeSection?.id ? 'block' : 'hidden print:block'}>
                    <GuideSectionCard section={section} query={query} sectionNumber={index + 1} />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 print:hidden">
                  <Button
                    type="button"
                    variant="outline"
                    className="max-w-[42%] min-w-0 justify-start"
                    disabled={!previousSection}
                    onClick={() => previousSection && setActiveSectionId(previousSection.id)}
                  >
                    <span className="truncate">{previousSection ? `← ${previousSection.title}` : 'Начало руководства'}</span>
                  </Button>
                  <div className="shrink-0 text-xs tabular-nums text-slate-400">
                    {activeSectionIndex + 1} из {filteredSections.length}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="max-w-[42%] min-w-0 justify-end"
                    disabled={!nextSection}
                    onClick={() => nextSection && setActiveSectionId(nextSection.id)}
                  >
                    <span className="truncate">{nextSection ? `${nextSection.title} →` : 'Конец руководства'}</span>
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                <div>По этому запросу ничего не найдено.</div>
                <button type="button" className="mt-3 font-semibold text-sky-700 hover:text-sky-900" onClick={() => setQuery('')}>
                  Очистить поиск
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function GuideLoadingState() {
  return (
    <div role="status" className="flex min-h-56 items-center justify-center rounded-md border border-slate-200 bg-slate-50 p-8 text-sm text-slate-600">
      <LoaderCircle className="mr-2 h-4 w-4 animate-spin text-sky-700" />
      Загружаем полный справочник...
    </div>
  )
}

function GuideLoadErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex min-h-56 flex-col items-center justify-center rounded-md border border-rose-200 bg-rose-50 p-8 text-center">
      <div className="text-sm font-medium text-rose-900">Полный справочник не загрузился.</div>
      <div className="mt-1 text-sm text-rose-700">Проверьте соединение и повторите загрузку.</div>
      <Button type="button" variant="outline" className="mt-4 gap-2 bg-white" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Повторить
      </Button>
    </div>
  )
}

function GuideSectionCard({
  section,
  query,
  sectionNumber,
}: {
  section: GuideSection
  query: string
  sectionNumber: number
}) {
  return (
    <article id={section.id} className="scroll-mt-24 rounded-md border border-slate-200 bg-white">
      <header className="border-b border-slate-100 bg-slate-50 px-5 py-4">
        <div className="text-xs font-semibold uppercase text-slate-400">Раздел {sectionNumber}</div>
        <h3 className="mt-1 text-lg font-semibold text-slate-950">{section.title}</h3>
        <p className="mt-1.5 text-sm leading-6 text-slate-600">{highlightGuideText(section.summary, query)}</p>
      </header>
      <div className="space-y-4 px-5 py-5">
        {section.id === 'sidebar' ? <GuideSidebarMock /> : null}
        {section.id === 'journal' ? <GuideTableMock /> : null}
        {section.id === 'lnk-psto' ? <GuideModalMock /> : null}
        {section.blocks.map((block, index) => (
          <GuideBlockView key={index} block={block} query={query} />
        ))}
      </div>
    </article>
  )
}

function GuideBlockView({ block, query }: { block: GuideBlock; query: string }) {
  if (block.type === 'p') {
    return <p className="text-sm leading-6 text-slate-600">{highlightGuideText(block.text, query)}</p>
  }

  if (block.type === 'list') {
    return (
      <ul className="grid gap-2 text-sm leading-6 text-slate-600">
        {block.items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            <span>{highlightGuideText(item, query)}</span>
          </li>
        ))}
      </ul>
    )
  }

  if (block.type === 'table') {
    return (
      <div className="guide-table-block">
        {block.title ? <h4 className="mb-2 text-sm font-semibold text-slate-900">{block.title}</h4> : null}
        <div className="overflow-hidden rounded-md border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  {block.table.columns.map((column) => (
                    <th key={column} className="border-r border-white px-3 py-2 text-left font-semibold last:border-r-0">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/70">
                    {row.map((cell, cellIndex) => (
                      <td key={`${rowIndex}-${cellIndex}`} className="border-r border-slate-100 px-3 py-2 align-top leading-6 text-slate-600 last:border-r-0">
                        {highlightGuideText(cell, query)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  if (block.type === 'flow') {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Route className="h-4 w-4 text-slate-500" />
          {block.title}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {block.steps.map((step, index) => (
            <div key={step} className="rounded-md border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase text-slate-400">Шаг {index + 1}</div>
              <div className="mt-1 text-sm leading-5 text-slate-700">{highlightGuideText(step, query)}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-sky-100 bg-sky-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-sky-950">
        <Info className="h-4 w-4" />
        {block.title}
      </div>
      <p className="mt-2 text-sm leading-6 text-sky-900">{highlightGuideText(block.text, query)}</p>
    </div>
  )
}

function GuideSidebarMock() {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" title="Экранный ориентир: левое меню приложения">
      <div className="mb-3 font-semibold text-slate-900">Сварка</div>
      <div className="grid gap-1">
        {['Сварочный журнал', 'ЛНК', 'Клейма', 'Процентные линии', 'Документы'].map((item) => (
          <div key={item} className="rounded border border-slate-200 bg-white px-3 py-1.5 text-slate-600">
            {item}
          </div>
        ))}
        <div className="mt-3 rounded border border-sky-100 bg-sky-50 px-3 py-1.5 font-medium text-slate-900">Настройки</div>
        <div className="rounded px-3 py-1.5 text-slate-500">Руководство пользователя</div>
      </div>
    </div>
  )
}

function GuideTableMock() {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3" title="Экранный ориентир: группы таблицы сварочного журнала">
      <div className="grid grid-cols-4 overflow-hidden rounded border border-slate-200 text-center text-xs font-semibold text-slate-600">
        <div className="border-r border-slate-200 bg-slate-50 px-2 py-2">Проект</div>
        <div className="border-r border-slate-200 bg-slate-50 px-2 py-2">Сварка</div>
        <div className="border-r border-slate-200 bg-slate-50 px-2 py-2">Клейма</div>
        <div className="bg-slate-50 px-2 py-2">Назначение</div>
        <div className="border-r border-t border-slate-200 px-2 py-2 text-slate-400">Линия</div>
        <div className="border-r border-t border-slate-200 px-2 py-2 text-slate-400">Дата</div>
        <div className="border-r border-t border-slate-200 px-2 py-2 text-slate-400">Корень_1</div>
        <div className="border-t border-slate-200 px-2 py-2 text-slate-400">РК / УЗК</div>
      </div>
    </div>
  )
}

function GuideModalMock() {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4" title="Экранный ориентир: вкладка заключений и имен">
      <div className="max-w-xl overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="grid grid-cols-3 gap-2 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span>Метод контроля</span>
          <span>Дата контроля</span>
          <span>Общий результат</span>
        </div>
        <div className="flex gap-4 border-b border-slate-200 px-3 pt-2 text-sm font-semibold">
          <span className="pb-2 text-slate-500">Стыки</span>
          <span className="border-b-2 border-sky-600 pb-2 text-sky-800">Заключения и имена · 3</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1 text-sm">
            <span className="rounded px-3 py-1 text-slate-500">Системное</span>
            <span className="rounded bg-white px-3 py-1 font-medium text-slate-900 shadow-sm">Пользовательское</span>
          </div>
          <span className="text-xs text-slate-500">Заполнено: 2/3</span>
        </div>
        <div className="grid grid-cols-[1fr_1.4fr] gap-3 border-t border-slate-100 px-3 py-2 text-xs">
          <span className="font-medium text-slate-700">Стык F16A</span>
          <span className="rounded border border-slate-200 px-2 py-1 text-slate-500">Название заключения</span>
        </div>
      </div>
    </div>
  )
}

function highlightGuideText(text: string, query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return text

  const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return parts.map((part, index) =>
    part.toLowerCase() === normalizedQuery.toLowerCase() ? (
      <mark key={`${part}-${index}`} className="rounded bg-amber-100 px-0.5 text-slate-950">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

function getSectionSearchText(section: GuideSection) {
  const blockText = section.blocks
    .flatMap((block) => {
      if (block.type === 'p') return [block.text]
      if (block.type === 'list') return block.items
      if (block.type === 'table') return [block.title ?? '', ...block.table.columns, ...block.table.rows.flat()]
      if (block.type === 'flow') return [block.title, ...block.steps]
      return [block.title, block.text]
    })
    .join(' ')
  return normalizeGuideText(`${section.title} ${section.summary} ${section.tags.join(' ')} ${blockText}`)
}

function normalizeGuideText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
