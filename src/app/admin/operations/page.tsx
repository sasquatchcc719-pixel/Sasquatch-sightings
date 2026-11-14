import { CellularDataUsage } from '@/components/admin/ops/cellular-data-usage'
import { OperationsSchedule } from '@/components/admin/ops/operations-schedule'
import { TruckTemperatureButton } from '@/components/admin/ops/truck-temperature'
import { TruckWeatherCard } from '@/components/truck-weather-card'

export default function OperationsPage() {
  return (
    <div className="space-y-5">
      <TruckWeatherCard
        temperature={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <TruckTemperatureButton />
            <CellularDataUsage />
          </div>
        }
      />
      <OperationsSchedule />
    </div>
  )
}
