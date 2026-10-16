import { OperationsSchedule } from '@/components/admin/ops/operations-schedule'
import { TruckWeatherCard } from '@/components/truck-weather-card'

export default function OperationsPage() {
  return (
    <div className="space-y-5">
      <TruckWeatherCard />
      <OperationsSchedule />
    </div>
  )
}
