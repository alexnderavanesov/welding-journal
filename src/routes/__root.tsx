import { useEffect, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { ConfirmActionProvider } from '@/lib/confirm-action-context'
import { SecurityProvider } from '@/lib/security-context'
import { APP_BOOTSTRAP_READY_EVENT, APP_BOOTSTRAP_RECOVERY_SCRIPT } from '@/lib/app-bootstrap-recovery'
import appCss from '@/styles.css?url'
import companyFavicon from '@/assets/company-favicon.png?url&no-inline'
import companyFaviconIco from '@/assets/company-favicon.ico?url&no-inline'
import companyFaviconSvg from '@/assets/company-favicon.svg?url&no-inline'
import developmentFavicon from '@/assets/development-favicon.svg?url&no-inline'

// Keep development tabs distinct; use a file URL because Safari can ignore
// data-URL favicons. All browsers receive the same asset.

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Учет сварки трубопроводов' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      ...(import.meta.env.DEV
        ? [{ rel: 'icon', href: developmentFavicon, type: 'image/svg+xml' }]
        : [
          { rel: 'icon', href: companyFaviconIco, type: 'image/x-icon', sizes: '16x16 32x32 48x48' },
          { rel: 'icon', href: companyFavicon, type: 'image/png', sizes: '64x64' },
          { rel: 'icon', href: companyFaviconSvg, type: 'image/svg+xml', sizes: 'any' },
        ]),
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  useEffect(() => {
    window.dispatchEvent(new Event(APP_BOOTSTRAP_READY_EVENT))
  }, [])
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <ConfirmActionProvider>
          <SecurityProvider>
            <Outlet />
          </SecurityProvider>
        </ConfirmActionProvider>
      </QueryClientProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <section
          id="app-bootstrap-recovery"
          hidden
          role="alert"
          style={{ position: 'fixed', inset: 0, zIndex: 100000, padding: '15vh 24px', background: '#f8fafc', color: '#0f172a', textAlign: 'center', fontFamily: 'sans-serif' }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Не удалось загрузить приложение</h1>
          <p style={{ margin: '16px 0' }}>Проверьте соединение и повторите попытку.</p>
          <button id="app-bootstrap-retry" type="button" style={{ padding: '12px 24px', borderRadius: 6, background: '#0f172a', color: '#fff', cursor: 'pointer' }}>Повторить</button>
          <p style={{ margin: '16px 0', fontSize: 14 }}>Если после восстановления соединения повтор не помогает, полностью закройте браузер и откройте приложение снова.</p>
        </section>
        <script
          dangerouslySetInnerHTML={{
            __html: 'window.process=window.process||{env:{}};window.process.env=window.process.env||{};' + APP_BOOTSTRAP_RECOVERY_SCRIPT,
          }}
        />
        <Scripts />
      </body>
    </html>
  )
}
