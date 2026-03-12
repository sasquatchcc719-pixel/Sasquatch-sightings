import { OpsPlaceholderPage } from '@/components/admin/ops/ops-placeholder-page'

export default function CustomersPage() {
  return (
    <OpsPlaceholderPage
      title="Customers"
      description="Customer search and saved service addresses are already wired into New Job. A dedicated customer management screen can build on that foundation next without blocking the schedule-first rollout."
      primaryHref="/admin/operations/new-job"
      primaryLabel="Use New Job"
    />
  )
}
