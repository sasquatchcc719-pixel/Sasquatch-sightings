import { PayrollTimesheetsView } from '@/components/admin/ops/PayrollTimesheetsView'

export default function PayrollTimesheetsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Payroll Timesheets</h2>
        <p className="text-sm text-slate-400">
          Manual payable hours for training, missed punches, admin work, and
          other non-GPS time.
        </p>
      </div>
      <PayrollTimesheetsView />
    </div>
  )
}
