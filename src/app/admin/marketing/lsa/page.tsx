import Link from 'next/link'
import { LsaDashboardView } from '@/components/admin/marketing/LsaDashboardView'

export default function LsaDashboardPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Google LSA</h2>
        <p className="text-sm text-slate-400">
          Every charge, every conversation, and what it all turned into.{' '}
          <Link
            href="/admin/marketing"
            className="text-emerald-300 hover:underline"
          >
            Compare against your other channels →
          </Link>
        </p>
      </div>
      <LsaDashboardView />
    </div>
  )
}
