import { DispatchMap } from '@/components/admin/ops/DispatchMap'

export default function DispatchPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Live Dispatch</h2>
        <p className="text-sm text-slate-400">
          Real-time location of clocked-in technicians. Updates every 20
          seconds.
        </p>
      </div>
      <DispatchMap />
    </div>
  )
}
