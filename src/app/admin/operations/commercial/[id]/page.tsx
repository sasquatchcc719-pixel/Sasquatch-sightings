import { requireAnyRole } from '@/lib/auth'
import { CommercialAccount } from '@/components/admin/ops/commercial-workspace'
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAnyRole(['admin', 'owner'])
  const { id } = await params
  return <CommercialAccount customerId={id} />
}
