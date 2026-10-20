import { redirect } from 'next/navigation'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import FleetTrackerDashboard from '@/components/admin/fleet-tracker-dashboard'

export default async function DispatchPage() {
  const { role } = await getUserWithRole()
  if (!hasRoleAccess(role, ['owner', 'admin', 'dispatcher'])) redirect('/admin')
  return <FleetTrackerDashboard />
}
