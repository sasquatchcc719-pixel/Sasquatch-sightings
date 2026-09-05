import { CustomersDirectory } from '@/components/admin/ops/customers-directory'
import { requireAnyRole } from '@/lib/auth'

export default async function CustomersPage() {
  const user = await requireAnyRole([
    'admin',
    'owner',
    'dispatcher',
    'marketing',
  ])
  return (
    <CustomersDirectory
      canDeleteCustomers={user.role === 'admin' || user.role === 'owner'}
    />
  )
}
