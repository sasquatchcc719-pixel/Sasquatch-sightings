import { OpsPlaceholderPage } from '@/components/admin/ops/ops-placeholder-page'

export default function OperationsSettingsPage() {
  return (
    <OpsPlaceholderPage
      title="Operations Settings"
      description="Availability rules, slot testing, and deeper QuickBooks controls are still available in the current foundation and will move into a cleaner settings screen as the scheduler build continues."
      primaryHref="/admin/operations/services"
      primaryLabel="Open Services"
    />
  )
}
