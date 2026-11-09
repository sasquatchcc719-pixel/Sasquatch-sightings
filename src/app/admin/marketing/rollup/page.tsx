import { redirect } from 'next/navigation'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { BusinessDecisionView } from '@/components/admin/business-decision-view'
import { WeeklyRollupView } from '@/components/admin/marketing/WeeklyRollupView'

export default async function MarketingRollupPage() {
  const { role } = await getUserWithRole()
  if (!hasRoleAccess(role, ['owner', 'admin', 'marketing'])) redirect('/admin')
  if (role === 'marketing') return <WeeklyRollupView />

  return (
    <div className="space-y-6">
      <BusinessDecisionView />
      <details className="mx-auto max-w-7xl rounded-2xl border border-white/10 bg-slate-950/70 p-5">
        <summary className="cursor-pointer font-semibold text-white">
          Detailed marketing history
        </summary>
        <p className="mt-3 text-sm text-slate-400">
          Existing spend, search and town records. Historical job values in this
          view use appointment quotes, not the invoice totals above.
        </p>
        <div className="mt-5">
          <WeeklyRollupView embedded />
        </div>
      </details>
    </div>
  )
}
