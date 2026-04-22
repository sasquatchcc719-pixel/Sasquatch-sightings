import { MyDayView } from '@/components/admin/ops/MyDayView'

export default function MyDayPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">My Day</h2>
        <p className="text-sm text-slate-400">
          Your personal GPS shift summary for today.
        </p>
      </div>
      <MyDayView />
    </div>
  )
}
