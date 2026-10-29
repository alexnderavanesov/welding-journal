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
        {section.id === 'lnk-psto' ? <p className="text-sm leading-6 text-slate-600">В окнах ЛНК, ПСТО и дубль-контроля данные стыка загружаются вместе с соответствующей им историей контроля. Если после открытия окна другой пользователь изменил записи, обновите данные перед повторным действием. При сохранении система проверяет актуальное состояние.</p> : null}
        {section.id === 'stamps' ? <p className="text-sm leading-6 text-slate-600">Во всех полях официальных и фактических клейм откройте список и введите любую часть клейма в строке поиска: например, «0» найдёт «ABC0». Регистр букв не важен. Сначала идут действующие карточки, затем архивные с пометкой «в архиве»; внутри каждой группы сохраняется алфавитный порядок с учётом чисел. Поиск только сужает список: значение меняется после выбора мышью или клавишей Enter; «Пусто» очищает поле. Если сохранённого клейма нет в текущем списке, оно остаётся видно с пометкой «нет в списке»; его можно явно очистить или заменить. Проверки при сохранении продолжают действовать. Без даты сварки списки клейм содержат всех сварщиков. После заполнения даты официальный список учитывает архив и отстранения на эту дату; НАКС и ДЛС проверяются как раньше. Фактические поля всегда предлагают всех сварщиков. Если у сохранённого стыка официальное клеймо перестало подходить, можно исправить изометрию, примечание и фактические клейма, не меняя дату сварки, параметры стыка и официальные клейма. Это правило действует и при массовом заполнении или замене данных через Excel. СП-02 при этом остаётся. При изменении даты, параметров или официальных клейм система снова проверит допуски и не даст сохранить неподходящее клеймо. Нельзя архивировать клеймо с даты, на которую или позднее есть стыки с ним в официальных либо фактических полях, включая неофициальные и неактуальные записи. Пустая дата сварки архивацию не блокирует. Например, последняя сварка 26.11 — архивировать можно с 27.11. Переключатель архива удалён; ЗВ-01 теперь обозначает только формат имени обычного стыка.</p> : null}
        {section.id === 'sidebar' ? <GuideSidebarMock /> : null}
        {section.id === 'journal' ? <><GuideTableMock /><p className="text-sm leading-6 text-slate-600">При удалении стыков из общих документов убираются только их позиции. Документ удаляется автоматически, если после этого в нём не осталось стыков. Несвязанные документы сохраняются; их можно удалить отдельно в разделе «Документы».</p><p className="text-sm leading-6 text-slate-600">Сварочный журнал работает на AG Grid. В верхней панели число записей и WDI годных показываются полностью; блок группировки располагается после сводки. На узком экране панель можно прокручивать по горизонтали. Фон горизонтальной полосы прокрутки прозрачен: когда ползунок появляется поверх нижнего края таблицы, строки под ним остаются видны. Так же устроена прокрутка в ЛНК, ПСТО и реестрах документов. При смене фильтра или сортировки прежние строки остаются на экране с отметкой «Обновление…» в нижней панели до готовности новой выборки. В это время действия со строками и выбор галочками временно недоступны, чтобы не изменить стык из прежней выборки. Ввод в быстрый поиск применяется после короткой паузы; выбор фильтра и сортировка запускают обновление сразу. Готовые строки появляются с коротким плавным переходом; он не задерживает доступность таблицы и отключается при системном уменьшении движения. Ещё не загруженные ячейки обозначаются серыми полосками — при открытии журнала, прокрутке и раскрытии групп. При вертикальной и горизонтальной прокрутке те же статичные полоски закрывают временно пустой участок до отрисовки ячеек. Во время движения фон остаётся неподвижным; после остановки он подстраивается под видимые столбцы. Они не мигают, не задерживают появление данных и не меняют выделение. При настоящем сбое над строками появляется отдельное сообщение: нажмите «Повторить загрузку». Отмена старого запроса при смене фильтра, сортировки или группировки ошибкой не считается. Если версия данных изменилась при первой загрузке и строки ещё не показаны, система один раз повторяет загрузку. Уже открытую таблицу обновляйте кнопкой «Обновить таблицу», когда появляется сообщение «Есть обновления». Выбор стыков галочками сохраняется; область ячеек после обновления нужно выделить заново. Если загрузка завершилась ошибкой, нажмите «Повторить загрузку». Подсказки в ячейках оставлены только у «Стыка» и «Следующего шага»: наведите указатель, чтобы увидеть карточку с пояснением. Прокрутка или Escape закрывает подсказку; первый Escape при открытой подсказке не сбрасывает поиск. Длинные названия, обозначения, реквизиты документов и примечания выровнены слева; стыки, клейма, числовые значения, даты и короткие классификаторы — по центру. Меню по правой кнопке на стыке и заголовке оформлены одинаково; в меню стыка сохранены рабочие действия и пояснения к недоступным командам. Диспетчер использует согласованные с таблицей шрифты, кнопки и бейджи; его задачи можно раскрыть над таблицей или открыть в отдельном окне. В «Настроить вид» доступны вкладки «Столбцы», «Оформление», «Темы» и «Мои виды» — такие же, как в реестрах документов. Найдите столбец, выберите плотность, переключатели оформления или карточку темы; личный вид сохраняется в этом браузере. ПКМ по заголовку открывает сортировку, группировку всех найденных стыков, закрепление, скрытие и сброс столбцов; ПКМ по разделу — скрытие раздела. Закрепление меняется только через ПКМ: перетаскивание меняет порядок, но не закрепляет столбцы у края. Маленькая булавка рядом с названием обозначает закрепление; наведите курсор, чтобы увидеть сторону. ПКМ по строке группы позволяет свернуть или развернуть её, а также все уровни группировки. «Развернуть все» действует и на группы ниже по списку, которые ещё не загружены, включая вложенные уровни. Данные подгружаются по мере просмотра; вся таблица сразу не скачивается. «Свернуть все» отменяет общее раскрытие; отдельную группу можно открыть или закрыть независимо. Меню мышью открывается без предварительной подсветки команды и не создаёт выделение ячеек. Сворачивание и раскрытие через меню снимают диапазон ячеек, сохраняя выбор стыков галочками. Shift+F10 открывает меню текущей ячейки с клавиатуры. Порядок нескольких группировок виден слева от поиска: цветные плашки можно перетаскивать мышью за название или значок точек; синяя отметка показывает место вставки, Escape отменяет перенос. На плашке также работают Alt + ← / →. Крестик на плашке снимает один уровень, отдельный крестик справа с подсказкой «Снять все группировки» — все уровни. При раскрытии и сворачивании группы соседние строки коротко и плавно сдвигаются. Загрузка начинается сразу; прокрутка прерывает переход. Если в системе включено уменьшение движения, переход отключён. Цвета плашек соответствуют уровням в таблице; галочка группы выбирает все её стыки по текущим фильтрам, включая ещё не показанные строки. Выбор галочками независим от выделения ячеек. В журнале, ЛНК и ПСТО выделите область ячеек и нажмите Shift+Пробел, чтобы отметить все стыки этой области, включая незагруженные строки. Несколько областей объединяются без повторов; заголовок группы выбирает все её стыки по текущему фильтру. Галочки вне области сохраняются. Если все стыки области уже отмечены, Shift+Пробел снимает с них галочки; при частичном выборе отмечает всю область. Обычный Пробел переключает стык или группу текущей ячейки; в полях ввода и на кнопках сохраняется обычное действие клавиши. Лимит выбора ЛНК и ПСТО продолжает действовать: при превышении прежний выбор сохраняется. В нижней строке рядом с «Выбрано» показаны «Стыков» — количество физических стыков, «WDI» — их суммарный дюйм-диаметр и «Сварка» — даты от самой ранней до самой поздней. Источник сводки подписан внизу: «По области», если выделены ячейки, иначе «По выбранным». В области каждый стык учитывается один раз, независимо от числа выбранных столбцов и пересечений; заголовок группы включает все её стыки по текущему фильтру. Сводка по выбранным включает незагруженные и скрытые фильтром записи. Счётчик «Выбрано» и рабочие действия всегда относятся к галочкам. Вертикальная линия отделяет итоги стыков от среднего, количества и суммы ячеек области. Ремонты одного соединения не удваивают количество и WDI; заменённый катушкой исходник исключается, стороны катушки считаются отдельно. Даты учитывают выбранные записи истории. Звёздочка у WDI или дат означает, что часть значений не заполнена; наведите указатель для пояснения. Пока идёт расчёт, показано «Итоги выбора: считаем…»; при ошибке доступно «Повторить». Такие же итоги выбора доступны в ЛНК и ПСТО. Сброс возвращает исходный порядок, линию и стык слева, итоговый статус справа. Tab пропускает системные поля; Enter и F2 выполняют действие ячейки, двойной клик открывает редактирование; номер стыка — полную картину. В сварочном журнале строки автоматически подгружаются при прокрутке; нажимать «Загрузить ещё» не нужно. Группы и их итоги охватывают всю найденную выборку. Вертикальная прокрутка общая со страницей: полоса находится у правого края окна. У верхней и нижней границ страницы сохраняется стандартное поведение браузера. Верхний блок уходит вверх, шапка столбцов остаётся на экране, а компактная строка статистики — под таблицей. Прокрутите страницу к началу, чтобы вернуть верхние кнопки и поиск. Выбранная сортировка по заголовку столбца сохраняется при фильтрации. Фильтр даты раскрывается по годам, месяцам и дням; точные значения времени и периодов доступны внутри дня. Ctrl+C (Cmd+C на Mac) копирует только значения выделенных ячеек без названий столбцов, включая незагруженные строки. Это правило действует в журнале, ЛНК, ПСТО и реестрах документов; при вставке в Excel лишней строки заголовков нет. Количество, сумма и среднее также относятся ко всему диапазону. Во время расчёта или копирования показывается состояние выполнения; если данные изменились, повторите действие после обновления таблицы. Подробнее — в рабочем разделе «Сварочный журнал».</p></> : null}
        {section.id === 'lnk-psto' ? <GuideModalMock /> : null}
        {['journal', 'work-lnk', 'work-psto'].includes(section.id) ? <p className="text-sm leading-6 text-slate-600">Повторное раскрытие недавно просмотренной группы может сразу показать уже загруженные строки той же версии таблицы. После смены фильтра или сортировки, собственного сохранения либо уведомления об обновлении группа при необходимости загружается заново. Чужие изменения не перестраивают открытую таблицу. Когда система обнаруживает новую версию, внизу появляется «Есть обновления» и кнопка «Обновить таблицу». До обновления показанные строки остаются на экране; для дозагрузки устаревшего отбора, копирования диапазона и актуальных итогов может понадобиться обновление. При открытии редактирования загружается свежая карточка стыка. Если другой пользователь изменит её до вашего сохранения, система объяснит конфликт и оставит введённые значения в форме. После собственного сохранения система сверяет загруженные строки с сервером и обновляет изменившиеся значения на месте, сохраняя раскрытые группы и рабочее положение. Если создание, удаление или изменение стыка меняет состав либо порядок строк, система обновляет состав и порядок строк в затронутой части таблицы. То же правило действует после сохранения заявок и результатов. Пока показано «Обновление…», действия со строками временно недоступны: система согласует данные всех загруженных групп. При смене выборки или восстановлении неполной загрузки может потребоваться перестроение таблицы.</p> : null}
        {section.id === 'work-psto' ? <div className="space-y-2 text-sm leading-6 text-slate-600">
          <p>В «Программе ПСТО» откройте «Исключения» и нажмите «Добавить исключение». Найдите любое звено через фильтры в заголовках столбцов: они учитывают все стыки, а не только текущую страницу. Внизу можно выбрать 25, 50 или 100 записей на странице. «ПСТО линии» показывает программу всей линии; «ПСТО цепочки» в списке исключений — индивидуальное решение. Система сама предложит противоположное назначение для выбранной цепочки. Проверьте линию, итоговое ПСТО и число стыков, укажите основание и сохраните. Основание показывается в существующей колонке «Основания назначения» сварочного журнала с подписью «ПСТО».</p>
          <p>В программе две вкладки: «Линии» и «Исключения». Таблицы поддерживают фильтры столбцов по всему набору, изменение ширины, скрытие и закрепление через меню заголовка. Фильтры учитывают друг друга; поиск внутри фильтра охватывает все значения, включая другие страницы. Группировки и отдельной настройки вида здесь нет. В исключениях порядок столбцов: проект, шифр, линия, ПСТО линии, цепочка, ПСТО цепочки, основание, действия.</p>
          <p>У назначенной линии есть две команды. «Снять назначение» исправляет случайное назначение, пока у затрагиваемых стыков нет данных ПСТО, ТВМТ и НК до ТО; дата и основание отмены не нужны. «Отменить ПСТО» используется после появления этих данных и сохраняет документы, результаты, дату и основание решения. Недоступная команда объясняет причину при наведении. Перед сохранением система повторно проверяет актуальные данные. История индивидуального исключения, которое не меняется при снятии программы линии, не блокирует снятие программы.</p>
          <p>В столбце «ПСТО линии» во всех таблицах программы одинаковые состояния: «Назначена», «Отменена», «Не назначена» или «Не определено». Фильтры используют эти же названия. Столбец «Действия» тоже можно сужать, расширять, скрывать и закреплять через его меню. При сужении закреплённых справа «Действий» соседние столбцы заполняют освободившееся место без пустой полосы.</p>
          <p>Список исключений содержит только действующие решения. При снятии исключения его запись и основание удаляются, а документы, результаты и этапы НК сохраняются. Если исключение понадобится снова, добавьте его заново и укажите основание. Отдельной истории назначений и снятий исключений нет.</p>
          <p>Решение действует на всю цепочку, включая неофициальные записи, будущие ремонты, вырезки, катушки и новый официальный стык с тем же номером. «Убрать исключение» возвращает программу линии. При совпадении назначения с программой линии исключение удаляется и само больше не включается. При переносе цепочки на другую линию исключение переносится вместе с ней, если всё ещё отличается от программы новой линии. Если своего исключения нет, учитывается сохранённое решение для этого номера цепочки на новой линии, даже если прежние стыки там удалены.</p>
          <p>Записанные ПСТО, ТВМТ и документы сохраняются. Снятие и повторное назначение меняют их действующее отображение, без повторного ввода и новых номеров. Этапы НК определяются итоговым назначением цепочки. По умолчанию записанный этап сохраняется. Если требуется перенос комплекта НК, раскройте «Этапы записанного НК»: здесь показаны только стыки с соответствующей историей и проверками переноса. Импорт наследует решение цепочки, но не редактирует исключения. При проверке переноса импорт учитывает программу целевой линии и её исключения независимо от текущих фильтров и наличия стыков на линии. Основание исключения и основание официальной отмены всей линии хранятся отдельно.</p>
        </div> : null}
        {['journal', 'work-lnk', 'work-psto'].includes(section.id) ? <p className="text-sm leading-6 text-slate-600">Перед открытием действий по стыкам система загружает свежие карточки выбранных записей. Если часть стыков удалена, операция не откроется с неполным составом. Ошибка загрузки отдельного окна не перезагружает таблицу: закройте сообщение или воспользуйтесь кнопкой «Обновить страницу». Если ошибка появилась при сохранении, сначала проверьте результат — сервер мог сохранить данные, даже если ответ не дошёл.</p> : null}
        {section.id === 'work-psto' ? <p className="text-sm leading-6 text-slate-600">ПСТО и ТВМТ используют общую с журналом непрерывную таблицу: группы, выбор и диапазоны охватывают весь отбор. Поля текущего цикла и профильные действия сохраняют свои правила.</p> : null}
        {section.id === 'work-documents' ? <p className="text-sm leading-6 text-slate-600">Галочки группы и шапки выбирают все документы текущего отбора, включая незагруженные; выбор за пределами фильтра сохраняется. Копирование и итоги диапазона также учитывают незагруженные записи. Перед массовым действием система проверяет актуальность выбранных документов.</p> : null}
        {section.id === 'work-documents' ? <p className="text-sm leading-6 text-slate-600">В пользовательских шаблонах ЖСР, чек-листа и ЗНИ поля ПСТО и ТВМТ показывают текущий цикл, как в таблице ПСТО. Это относится и к формированию, и к повторному скачиванию из истории. Если новый повтор только начат, его незаполненные поля остаются пустыми; результаты предыдущего цикла в них не подставляются. Системные заявки и заключения показывают тот исторический цикл, к которому относятся.</p> : null}
        {section.id === 'work-documents' ? <p className="text-sm leading-6 text-slate-600">Если после открытия подтверждения удаления ЖСР, чек-листа или ЗНИ изменился его состав, например был удалён один из стыков, старое подтверждение не сработает. Обновите историю, проверьте оставшийся состав и подтвердите удаление заново.</p> : null}
        {section.id === 'sidebar' ? <p className="text-sm leading-6 text-slate-600">Если браузер не смог загрузить приложение или раздел, нажмите «Повторить» на экране ошибки после восстановления соединения. При повторе система заново получает файлы приложения и обновляет страницу; данные и настройки не очищаются. Для раздела система может сначала сделать одну автоматическую попытку. Если повтор не помогает, полностью закройте браузер и откройте приложение снова: Safari может сохранять неудачную загрузку даже после восстановления соединения.</p> : null}
        {section.id === 'work-lnk' ? <p className="text-sm leading-6 text-slate-600">ЛНК работает на общей с журналом и ПСТО таблице AG Grid. Настройки ЛНК независимы; результаты методов и этапов подводятся по всей группе. В столбцах «Послойный ВИК» и «Послойный ПВК» ссылки «Кромки» и «Слои» располагаются рядом при выключенном переносе текста и друг под другом при включённом. Обе ссылки доступны при любой плотности строк, включая «Компактно». Поиск, сортировка, группы, выбор галочками, диапазоны и копирование охватывают всю найденную выборку. Строки подгружаются автоматически; выбранные записи сохраняются за пределами фильтра. В существующую заявку основного ЛНК можно добавить новые стыки, даже если по другим уже внесены результаты или заключения: «Заявка» → «Добавить позиции», затем выберите заявку, методы и стыки и нажмите «Добавить в заявку». Старые результаты и заключения сохраняются; состав заявки обновляется, новые позиции получают «ожидает НК» и не входят в прежние заключения. Дата сварки должна быть не позднее даты заявки, а добавляемая позиция — без своей заявки, результата и заключения. Остальные проверки назначения, этапов и хронологии сохраняются. Ниже описаны рабочие действия и вывод текущего вида.</p> : null}
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
        <div className="border-t border-slate-200 px-2 py-2 text-slate-400">РК - УЗК</div>
      </div>
    </div>
  )
}

function GuideModalMock() {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4" title="Экранный ориентир: вкладка заключений и имен">
      <p className="mb-3 text-xs text-slate-600">Название заявки или заключения в отчёте открывает предпросмотр конкретного документа по шаблону внутри сайта. Escape возвращает к отчёту или картине стыка.</p>
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
