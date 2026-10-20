import { InvoiceDetail } from '@/components/admin/ops/invoice-detail'
import { requireAnyRole } from '@/lib/auth'

type InvoiceDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({
  params,
}: InvoiceDetailPageProps) {
  const { id } = await params
  let showVehicleHistory = false
  try {
    await requireAnyRole(['owner', 'admin', 'dispatcher'])
    showVehicleHistory = true
  } catch {
    /* Other existing invoice roles keep their normal invoice view. */
  }
  return (
    <InvoiceDetail invoiceId={id} showVehicleHistory={showVehicleHistory} />
  )
}
