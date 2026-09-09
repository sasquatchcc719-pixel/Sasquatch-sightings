import { requireAnyRole } from '@/lib/auth'
import { VehicleHelp } from '@/components/tech/vehicle-help'
import { EmergencyScheduleHelp } from '@/components/tech/emergency-schedule-help'

export default async function VehicleHelpPage() {
  await requireAnyRole(['admin', 'owner', 'tech'])
  return <VehicleHelp scheduleHelp={<EmergencyScheduleHelp />} />
}
