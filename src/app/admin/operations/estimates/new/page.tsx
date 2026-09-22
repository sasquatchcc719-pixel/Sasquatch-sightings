import { CommercialEstimateWorkspace } from '@/components/admin/ops/commercial-estimate-workspace'
import { requireAnyRole } from '@/lib/auth'

export default async function NewEstimatePage() {
  await requireAnyRole(['admin', 'owner', 'dispatcher'])
  return <CommercialEstimateWorkspace />
}
