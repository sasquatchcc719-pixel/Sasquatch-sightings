import { requireAnyRole } from '@/lib/auth'
import { CommercialAccounts } from '@/components/admin/ops/commercial-workspace'
export default async function Page() {
  await requireAnyRole(['admin', 'owner'])
  return <CommercialAccounts />
}
