import { requireAnyRole } from '@/lib/auth'
import { VehicleHelp } from '@/components/tech/vehicle-help'

export default async function VehicleHelpPage() {
  const access = await requireAnyRole(['admin', 'owner', 'tech'])
  return <VehicleHelp driverName={access.staff?.display_name || ''} />
}
