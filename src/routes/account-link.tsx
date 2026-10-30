import { createFileRoute } from '@tanstack/react-router'
import { AccountLinkPage } from '@/components/account-link-page'
export const Route = createFileRoute('/account-link')({ component: AccountLinkPage, ssr: false })
