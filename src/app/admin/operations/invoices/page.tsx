import { OpsPlaceholderPage } from '@/components/admin/ops/ops-placeholder-page'

export default function InvoicesPage() {
  return (
    <OpsPlaceholderPage
      title="Invoices"
      description="Invoices now have dedicated detail pages from each job. This list screen can grow into a full invoice queue after the schedule and job workflows settle."
      primaryHref="/admin/operations"
      primaryLabel="Open Schedule"
    />
  )
}
