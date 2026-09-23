import { requireAnyRole } from '@/lib/auth'
import { CommercialAccount } from '@/components/admin/ops/commercial-workspace'
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ estimate?: string; action?: string }>
}) {
  await requireAnyRole(['admin', 'owner'])
  const { id } = await params
  const { estimate, action } = await searchParams
  return (
    <CommercialAccount
      customerId={id}
      initialEstimateId={estimate}
      autoOpenRecurring={action === 'recurring'}
    />
  )
}
