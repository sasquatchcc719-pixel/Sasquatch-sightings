import { OpsPlaceholderPage } from '@/components/admin/ops/ops-placeholder-page'

export default function EstimatePage() {
  return (
    <OpsPlaceholderPage
      title="Estimate"
      description="Estimate is reserved as its own future workflow, separate from standard jobs. For now, build standard work from New Job and keep estimate behavior isolated for the next phase."
      primaryHref="/admin/operations/new-job"
      primaryLabel="Open New Job"
    />
  )
}
