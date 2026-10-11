import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTree, Search } from 'lucide-react'
import { BufferedDocumentNameInput } from './buffered-document-name-input'
import { FieldHelp } from './field-help'

export type DocumentCompositionItem = { joint: string; project: string; subtitle: string; line: string; method: string; stage: string; cycle: number | null; source: string }
export type DocumentCompositionPage = { items: DocumentCompositionItem[]; total: number; totalPositions: number; page: number }

export function DocumentCompositionPanel({ title, cacheKey, load, onClose, inline = false }: {
  title: string; cacheKey: string; load: (query: string, page: number) => Promise<DocumentCompositionPage>; onClose: () => void; inline?: boolean
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0)
  const result = useQuery({ queryKey: ['document-operation-composition', cacheKey, search, page], queryFn: () => load(search, page),
    staleTime: Infinity, gcTime: 5 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false })
  const data = result.data
  return <aside aria-label="Состав будущего документа" className={`flex min-h-0 min-w-0 flex-col border-slate-200 bg-slate-50/70 p-3 sm:p-4 ${inline ? 'mt-4 rounded-lg border' : 'flex-1 border-l'}`}>
    {!inline ? <div className="mb-3 flex items-center justify-between gap-2"><button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50" onClick={onClose}>← Назад</button><span className="text-xs text-slate-500">Только просмотр</span></div> : null}
    <div className={inline ? 'flex flex-wrap items-center justify-between gap-2' : 'rounded-lg border border-slate-200 bg-white p-3'}>
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><ListTree aria-hidden="true" className="h-4 w-4 text-sky-600" />Состав документа
        <FieldHelp label="Что показано в составе">Одна позиция — стык и его метод или цикл контроля. Один стык может занимать несколько позиций. Источник показывает, из какого документа взята позиция. Поиск и страницы ничего не исключают из документа.</FieldHelp>
      </div>
      <h3 className={inline ? 'sr-only' : 'mt-1 break-words text-sm font-semibold leading-5 text-slate-800'}>{title}</h3>
      {inline ? <button type="button" className="rounded-md px-2 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100" onClick={onClose}>Свернуть состав</button> : null}
    </div>
    <div className="relative my-3"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><BufferedDocumentNameInput value={search} onCommit={value => { setSearch(value); setPage(0) }} aria-label="Поиск по составу" placeholder="Найти стык, линию или источник" className="pl-9" /></div>
    {!inline ? <p className="mb-3 text-xs text-slate-500">Все позиции сохраняются — поиск только помогает их найти.</p> : null}
    {result.isPending ? <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-800">Загружаем состав…</p> : result.error ? <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{result.error.message}<button type="button" className="ml-2 underline" onClick={() => void result.refetch()}>Повторить</button></div> : null}
    {data ? <>
      <div className={`min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white ${inline ? 'max-h-[min(45vh,24rem)]' : 'flex-1'}`}>
        <table className="block w-full table-fixed text-left text-xs sm:table"><thead className="sticky top-0 hidden bg-slate-100 text-slate-500 sm:table-header-group"><tr><th className="w-[13%] p-3">Стык</th><th className="w-[30%] p-3">Расположение</th><th className="w-[24%] p-3">Контроль</th><th className="p-3">Исходный документ</th></tr></thead>
          <tbody className="block sm:table-row-group">{data.items.map((item, index) => <tr key={index} className="block border-b border-slate-100 p-3 last:border-0 sm:table-row sm:p-0">
            <td className="block break-words py-1 align-top font-semibold text-slate-800 sm:table-cell sm:p-3"><span className="mr-1 font-normal text-slate-400 sm:hidden">Стык</span>{item.joint || '—'}</td>
            <td className="block break-words py-1 align-top leading-5 text-slate-600 sm:table-cell sm:p-3"><p>{item.project || '—'}</p><p><span className="text-slate-400">Шифр: </span>{item.subtitle || '—'}</p><p><span className="text-slate-400">Линия: </span>{item.line || '—'}</p></td>
            <td className="block break-words py-1 align-top leading-5 sm:table-cell sm:p-3"><span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800">{item.method || '—'}</span><p className="mt-1 text-slate-500">{item.stage || '—'}</p>{item.cycle !== null ? <p className="text-slate-500">Цикл {item.cycle}</p> : null}</td>
            <td className="block break-words py-1 align-top leading-5 text-slate-600 sm:table-cell sm:p-3"><span className="mr-1 text-slate-400 sm:hidden">Источник:</span>{item.source || '—'}</td>
          </tr>)}</tbody>
        </table>
        {!data.items.length ? <p className="p-6 text-center text-sm text-slate-500">По запросу позиций нет. Попробуйте другой поиск.</p> : null}
      </div>
      <div className="mt-3 flex shrink-0 items-center justify-between gap-2 text-xs text-slate-500"><button type="button" className="rounded-md px-2 py-1.5 hover:bg-slate-100 disabled:opacity-30" disabled={!data.page} onClick={() => setPage(data.page - 1)}>← Предыдущие</button><span className="text-center tabular-nums">Позиций: {data.total} / {data.totalPositions}<br />Страница {data.page + 1} / {Math.max(1, Math.ceil(data.total / 50))}</span><button type="button" className="rounded-md px-2 py-1.5 hover:bg-slate-100 disabled:opacity-30" disabled={(data.page + 1) * 50 >= data.total} onClick={() => setPage(data.page + 1)}>Следующие →</button></div>
    </> : null}
  </aside>
}
