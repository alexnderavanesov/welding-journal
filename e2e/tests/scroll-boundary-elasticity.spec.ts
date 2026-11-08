import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { cleanupLineProgramProjects, withLineProgramFixture } from '../line-program-fixtures'
import { checkInstalledSafariBoundaries } from '../scroll-boundary-safari'

const project = 'E2E elastic boundaries'
test.beforeAll(async () => withLineProgramFixture(async db => {
  await db.query(`insert into weld_joints(project_title,subtitle_code,line,joint,weld_date,connection_type,
    officiality,revision_actuality,has_vik,vik_result,weld_length,stamp_1_z_fact)
    select $1,'ELASTIC','BOUNDARY','ОП'||n,'2026-11-01','Т1','действующий','актуальная','да','годен',120,'ELASTIC-A'
    from generate_series(1,3) n`, [project])
  const { rows: [line] } = await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent)
    values($1,'ELASTIC','ELASTIC-LINE','II','A',100,10) returning id`, [project])
  await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,weld_date,connection_type,
    officiality,revision_actuality,has_vik,vik_result,stamp_1_k)
    select $1,$2,'ELASTIC','ELASTIC-LINE','F'||n,'2026-11-01','С17','действующий','актуальная','да','годен','ELASTIC-B'
    from generate_series(1,40) n`, [line.id, project])
}))
test.afterAll(() => cleanupLineProgramProjects([project]))

test('installed Safari keeps native wheel boundary handling', async ({ page }, info) => {
  test.skip(process.env.SCROLL_BOUNDARY_SAFARI !== '1', 'Opt-in installed Safari with its own local driver')
  test.setTimeout(120_000)
  await page.goto('/statistics')
  await checkInstalledSafariBoundaries(page, info)
})

async function checkEdges(page: Page, info: TestInfo, name: string) {
  await page.waitForLoadState('networkidle')
  // Registry placeholders have a provisional row count until their first
  // server-side block is ready. Test the settled table, not that load resize.
  const registry = page.locator('.document-grid-footer')
  if (await registry.count()) await expect(registry).not.toContainText('Загрузка')
  await expect(page.locator('.journal-loading-cell')).toHaveCount(0)
  const overscroll = await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)
  expect(['none', 'chain'], `${name}: the page must allow its native spring`).not.toContain(overscroll)
  const samples = await probeEdges(page)
  await info.attach(name, { body: JSON.stringify(samples), contentType: 'application/json' })
  for (const sample of samples) {
    expect(Math.abs(sample.base - (sample.edge === 'top' ? 0 : sample.maximum)), `${name}, ${sample.edge}: probe starts at the real page edge`).toBeLessThan(1)
    expect(sample.writes, `${name}, ${sample.edge}: native return must not be cancelled by scrollTo`).toEqual([])
    expect(new Set(sample.heights).size, `${name}, ${sample.edge}: no phantom page height`).toBe(1)
    expect(sample.frames.every(frames => JSON.stringify(frames) === JSON.stringify(sample.frames[0])), `${name}, ${sample.edge}: stable grid geometry`).toBe(true)
  }
}

/** Headless wheels do not reproduce native macOS momentum phases. Feed the
 * browser-reported elastic offset and matching geometry to the real adapters;
 * record any JS correction instead of letting it hide the defect by clamping. */
async function probeEdges(page: Page) {
  return page.evaluate(async () => {
    const settle = async () => { for (let i = 0; i < 3; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) }
    const scroll = window.scrollTo.bind(window)
    const savedScroll = window.scrollTo
    const yDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')!
    const rect = Element.prototype.getBoundingClientRect
    const frameGeometry = () => [...document.querySelectorAll<HTMLElement>('[data-program-page-scroll] > .program-grid-frame')].map(frame => `${frame.style.top}:${frame.style.height}`)
    const results: { edge: string; base: number; maximum: number; setup: { height: number; y: number; maximum: number }[]; writes: number[]; heights: number[]; frames: string[][] }[] = []
    for (const edge of ['top', 'bottom']) {
      // Auto-height master/detail rows and sticky borders may finish measuring
      // after the scroll event. Reaching the old bottom is not reaching the new
      // bottom: re-position only during setup, before recording any JS writes.
      // Otherwise ordinary in-range movement is mislabelled as elastic scroll.
      let stable = 0, previousGeometry = ''
      const setup: { height: number; y: number; maximum: number }[] = []
      for (let attempt = 0; attempt < 90 && stable < 8; attempt++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const height = document.documentElement.scrollHeight
        const maximum = Math.max(0, height - window.innerHeight)
        const target = edge === 'top' ? 0 : maximum
        const atEdge = Math.abs(window.scrollY - target) < 1
        const movingDetail = [...document.querySelectorAll<HTMLElement>('[data-program-motion]')].some(element => element.getClientRects().length && !element.closest('[hidden]'))
        const geometry = JSON.stringify([height, frameGeometry()])
        setup.push({ height, y: window.scrollY, maximum })
        stable = atEdge && !movingDetail && geometry === previousGeometry ? stable + 1 : 0
        previousGeometry = geometry
        if (!atEdge) scroll({ top: target, left: window.scrollX, behavior: 'instant' })
      }
      if (stable < 8) throw Error(`Page layout did not settle at ${edge}: ${JSON.stringify(setup.slice(-8))}`)
      const base = window.scrollY
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      let delta = 0
      const sample = { edge, base, maximum, setup, writes: [] as number[], heights: [] as number[], frames: [] as string[][] }
      Object.defineProperty(window, 'scrollY', { configurable: true, get: () => base + delta })
      Element.prototype.getBoundingClientRect = function () {
        const value = rect.call(this)
        if (!this.matches('[data-program-page-scroll], .journal-page-track, [data-scroll-top-boundary]')) return value
        return new DOMRect(value.x, value.y - delta, value.width, value.height)
      }
      window.scrollTo = ((first: number | ScrollToOptions, second?: number) => sample.writes.push(typeof first === 'number' ? second ?? 0 : first.top ?? 0)) as typeof window.scrollTo
      try {
        for (const offset of [0, 24, 80, 32, 0]) {
          delta = (edge === 'top' ? -1 : 1) * offset
          window.dispatchEvent(new Event('scroll'))
          await settle()
          sample.heights.push(document.documentElement.scrollHeight)
          sample.frames.push(frameGeometry())
        }
      } finally {
        window.scrollTo = savedScroll
        Object.defineProperty(window, 'scrollY', yDescriptor)
        Element.prototype.getBoundingClientRect = rect
        window.dispatchEvent(new Event('scroll'))
        await settle()
      }
      results.push(sample)
    }
    return results
  })
}

test('statistics supports: overscroll does not fight native return at either edge', async ({ page }, info) => {
  await page.goto('/statistics')
  await page.getByRole('button', { name: 'Опоры', exact: true }).click()
  await expect(page.getByTestId('support-statistics')).toBeVisible()
  await expect(page.locator('[data-program-page-scroll]').first()).toBeVisible()
  await checkEdges(page, info, 'supports')
})

test('every statistics tab preserves native boundary behaviour', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.goto('/statistics')
  for (const tab of ['Общая', 'ЛНК', 'ПСТО', 'Опоры', 'Сварщики', 'Полинейная сводка']) {
    await page.getByRole('main').getByRole('button', { name: tab, exact: true }).click()
    await checkEdges(page, info, `statistics-${tab}`)
  }
})

test('every settings tab and rules subtab preserves native boundary behaviour', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/settings')
  for (const tab of ['Документы', 'Заявки и заключения', 'Данные', 'Системные индексы', 'Правила и проверки', 'Расчет дюймов', 'Процессы контроля']) {
    await page.getByRole('main').getByRole('button', { name: tab, exact: true }).click()
    await checkEdges(page, info, `settings-${tab}`)
    if (tab === 'Документы') {
      for (const category of ['Общие', 'Пользовательские', 'Системные']) {
        await page.getByRole('tab', { name: category, exact: true }).click()
        const templates = page.locator('#settings-panel-templates .grid > div:first-child > button').filter({ has: page.locator('span.font-semibold') })
        expect(await templates.count()).toBeGreaterThan(0)
        const labels = await templates.allTextContents()
        for (let index = 0; index < labels.length; index++) {
          await templates.nth(index).click()
          await checkEdges(page, info, `settings-template-${category}-${index}`)
          const forms = page.locator('#settings-panel-templates [role="tablist"]:not([aria-label="Группы шаблонов документов"])').getByRole('tab')
          for (let form = 0; form < await forms.count(); form++) {
            await forms.nth(form).click()
            await checkEdges(page, info, `settings-template-${category}-${index}-form-${form}`)
          }
        }
      }
    }
    if (tab === 'Правила и проверки') for (const id of ['system', 'input', 'tasks', 'warnings', 'exceptions', 'parameters']) {
      await page.locator(`#rules-tab-${id}`).click()
      await checkEdges(page, info, `settings-rules-${id}`)
    }
  }
})

test('reports, references, account tabs and system rule tables preserve native boundaries', async ({ page }, info) => {
  test.setTimeout(180_000)
  for (const route of ['/journal', '/lnk', '/psto', '/documents', '/user-guide', '/activity',
    '/account?tab=profile', '/account?tab=users', '/account?tab=activity', '/account?tab=guide',
    '/account?tab=rules&section=connections', '/account?tab=rules&section=checks']) {
    await page.goto(route)
    await checkEdges(page, info, route)
  }
  await page.goto('/references')
  for (const tab of ['Клейма', 'Специалисты', 'Технологические карты']) {
    await page.getByRole('tab', { name: tab, exact: true }).click()
    await checkEdges(page, info, `references-${tab}`)
  }
})

test('every document registry and manual generation tab preserves native boundaries', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/documents')
  const navigation = page.locator('[data-documents-navigation]')
  const types = navigation.getByRole('button')
  await expect(types.first()).toBeVisible()
  const labels = await types.allTextContents()
  for (let index = 0; index < labels.length; index++) {
    await types.nth(index).click()
    const tabs = navigation.getByRole('tab')
    if (await tabs.count()) {
      for (const tab of ['История', 'Формирование']) {
        await navigation.getByRole('tab', { name: tab, exact: true }).click()
        await checkEdges(page, info, `documents-${labels[index]}-${tab}`)
      }
    } else {
      await checkEdges(page, info, `documents-${labels[index]}`)
    }
  }
})

test('line tabs, nested stamp/joint tables and the assignment dialog keep native scrolling', async ({ page }, info) => {
  test.setTimeout(180_000)
  await page.goto('/line-program')
  for (const tab of ['Все линии', '100%-ные линии', 'Процентные линии', 'Опоры']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await checkEdges(page, info, `program-${tab}`)
  }
  await page.getByRole('button', { name: 'Все линии', exact: true }).click()
  await page.getByLabel('Поиск программы линий').fill('ELASTIC-LINE')
  await page.getByRole('button', { name: 'Расчёт линии ELASTIC-LINE', exact: true }).click()
  await checkEdges(page, info, 'program-stamps')
  await page.getByRole('button', { name: 'Клеймо ELASTIC-B', exact: true }).click()
  await expect(page.locator('[data-testid="stamp-joints-container"] [data-program-grid="joints"]')).toHaveAttribute('data-program-row-count', '40')
  await checkEdges(page, info, 'program-nested-joints')
  await page.getByTestId('line-program-detail').getByTestId('program-scope-actions').getByRole('button', { name: /^Назначения/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Назначения · ELASTIC-LINE', exact: true })
  await expect(dialog).toBeVisible()
  const body = dialog.getByTestId('assignment-dialog-body')
  await expect(body).toHaveCSS('overscroll-behavior-y', 'contain')
  const base = await page.evaluate(() => window.scrollY)
  for (const direction of [-1, 1]) {
    await body.evaluate((element, direction) => { element.scrollTop = direction < 0 ? 0 : element.scrollHeight }, direction)
    await body.hover()
    await page.mouse.wheel(0, direction * 500)
    await page.waitForTimeout(80)
    expect(await page.evaluate(() => window.scrollY), 'Dialog scroll must not move the background').toBe(base)
  }
})
