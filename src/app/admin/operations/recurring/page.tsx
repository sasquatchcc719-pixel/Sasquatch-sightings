import { OpsPlaceholderPage } from '@/components/admin/ops/ops-placeholder-page'

export default function RecurringPage() {
  return (
    <OpsPlaceholderPage
      title="Recurring Job"
      description="Recurring scheduling will stay separate from the standard job flow. This placeholder keeps the route and navigation in place until monthly and quarterly frequency rules are implemented."
      primaryHref="/admin/operations"
      primaryLabel="Back to Schedule"
    />
  )
}
