import { TimesheetsView } from '@/components/admin/ops/TimesheetsView'

export default function TimesheetsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">GPS Timesheets</h2>
        <p className="text-sm text-slate-400">
          Per-shift breakdown of travel time vs. on-site time. Shadow mode —
          billing and payroll are unchanged.
        </p>
      </div>
      <TimesheetsView />
    </div>
  )
}
