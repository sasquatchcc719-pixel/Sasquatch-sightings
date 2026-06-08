import { TimesheetsView } from '@/components/admin/ops/TimesheetsView'

export default function TimesheetsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">GPS Activity</h2>
        <p className="text-sm text-slate-400">
          Location-derived shift history for dispatch review. Payroll timesheets
          are tracked separately.
        </p>
      </div>
      <TimesheetsView />
    </div>
  )
}
