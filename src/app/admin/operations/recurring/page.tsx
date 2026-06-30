import { RecurringManager } from '@/components/admin/ops/recurring-manager'
import { ClientRequestsPanel } from '@/components/admin/ops/client-requests-panel'

export default function RecurringPage() {
  return (
    <>
      <ClientRequestsPanel />
      <RecurringManager />
    </>
  )
}
