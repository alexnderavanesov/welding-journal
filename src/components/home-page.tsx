import { HomePageView } from '@/components/home-page-view'
import { useHomePageController } from '@/lib/use-home-page-controller'

export function HomePage() {
  const props = useHomePageController()

  return <HomePageView {...props} />
}
