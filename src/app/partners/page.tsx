import { redirect } from 'next/navigation'
import { createClient } from '@/supabase/server'
import { getUserWithRole } from '@/lib/auth'
import { PartnerDashboard } from '@/components/partners/partner-dashboard'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { LogoutButton } from '@/components/logout-button'
import Link from 'next/link'

export default async function PartnersPage() {
  const { user, role, partner } = await getUserWithRole()

  // Must be authenticated
  if (!user) {
    redirect('/auth/login')
  }

  // Must be a partner
  if (role !== 'partner' || !partner) {
    redirect('/protected')
  }

  // Fetch referrals for this partner
  const supabase = await createClient()
  const { data: referrals } = await supabase
    .from('referrals')
    .select('*')
    .eq('partner_id', partner.id)
    .order('created_at', { ascending: false })

  // Fetch incoming work (outbound referrals sent TO this partner)
  const { data: incomingWork } = await supabase
    .from('outbound_referrals')
    .select('*')
    .eq('partner_id', partner.id)
    .order('created_at', { ascending: false })

  // Calculate stats
  const totalReferrals = referrals?.length || 0
  const convertedReferrals =
    referrals?.filter((r) => r.status === 'converted').length || 0
  const pendingReferrals =
    referrals?.filter((r) => r.status === 'pending').length || 0
  const bookedReferrals =
    referrals?.filter((r) => r.status === 'booked').length || 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-900 via-green-800 to-emerald-900">
      {/* Navigation */}
      <nav className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/partners" className="flex items-center gap-2">
            <span className="text-2xl">🦶</span>
            <span className="text-lg font-bold text-white">
              Sasquatch Partner Portal
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-white/70 sm:block">
              {partner.company_name}
            </span>
            <ThemeSwitcher />
            <LogoutButton />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PartnerDashboard
          partner={partner}
          referrals={referrals || []}
          incomingWork={incomingWork || []}
          stats={{
            creditBalance: partner.credit_balance,
            totalReferrals,
            convertedReferrals,
            pendingReferrals,
            bookedReferrals,
          }}
        />
      </div>
    </main>
  )
}
