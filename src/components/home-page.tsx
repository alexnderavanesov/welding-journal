import { HomePageView } from '@/components/home-page-view'
import { useHomePageController } from '@/lib/use-home-page-controller'
import { useProjectSettingsSync } from '@/lib/use-project-settings-sync'
import { SiteSecurityGate } from '@/lib/security-context'
import type { ActiveReport } from '@/lib/home-state'

type HomePageProps = {
  activeReport?: ActiveReport
  onActiveReportChange?: (report: ActiveReport) => void
}

export function HomePage(props: HomePageProps) {
  return (
    <SiteSecurityGate>
      <UnlockedHomePage {...props} />
    </SiteSecurityGate>
  )
}

function UnlockedHomePage(props: HomePageProps) {
  useProjectSettingsSync()
  const viewProps = useHomePageController(props)

  return <HomePageView {...viewProps} />
}
