import { HomePageView } from '@/components/home-page-view'
import { useHomePageController } from '@/lib/use-home-page-controller'
import { useProjectSettingsSync } from '@/lib/use-project-settings-sync'
import { SiteSecurityGate } from '@/lib/security-context'

export function HomePage() {
  return (
    <SiteSecurityGate>
      <UnlockedHomePage />
    </SiteSecurityGate>
  )
}

function UnlockedHomePage() {
  useProjectSettingsSync()
  const props = useHomePageController()

  return <HomePageView {...props} />
}
