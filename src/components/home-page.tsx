import { HomePageView } from '@/components/home-page-view'
import { useHomePageController } from '@/lib/use-home-page-controller'
import { SiteSecurityGate } from '@/lib/security-context'

export function HomePage() {
  const props = useHomePageController()

  return (
    <SiteSecurityGate>
      <HomePageView {...props} />
    </SiteSecurityGate>
  )
}
