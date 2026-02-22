import { redirect } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'
import { PartnerDashboard } from '@/components/partners/partner-dashboard'
import { ThemeSwitcher } from '@/components/theme-switcher'
import Link from 'next/link'

// Mock data so admins can preview the Partner Dashboard. Changes to the
// PartnerDashboard component here apply to real partner accounts too.
const DEMO_PARTNER = {
  id: 'demo-partner-id',
  name: 'Jamie Smith',
  email: 'jamie@example.com',
  company_name: 'Mountain View Realty',
  credit_balance: 45,
  backlink_opted_in: true,
  backlink_verified: true,
}

const DEMO_REFERRALS = [
  {
    id: 'ref-1',
    client_name: 'Alex Johnson',
    client_phone: '(719) 555-0101',
    notes: 'Interested in whole-house cleaning after listing.',
    status: 'converted' as const,
    credit_amount: 25,
    booked_via_link: true,
    created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    converted_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ref-2',
    client_name: 'Sam Rivera',
    client_phone: '(719) 555-0102',
    notes: null,
    status: 'booked' as const,
    credit_amount: 25,
    booked_via_link: false,
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    converted_at: null,
  },
  {
    id: 'ref-3',
    client_name: 'Jordan Lee',
    client_phone: '(719) 555-0103',
    notes: 'Closing next month.',
    status: 'pending' as const,
    credit_amount: 25,
    booked_via_link: false,
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    converted_at: null,
  },
]

const DEMO_INCOMING_WORK = [
  {
    id: 'out-1',
    client_name: 'Taylor Green',
    client_phone: '(719) 555-0201',
    client_email: 'taylor@example.com',
    description: '3BR home, move-out cleaning needed by Friday',
    notes: 'Keys at lockbox.',
    referral_fee: 50,
    status: 'pending' as const,
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: null,
  },
]

export default async function PartnerDashboardDemoPage() {
  const { user, role } = await getUserWithRole()

  if (!user) redirect('/auth/login')
  if (role !== 'admin') redirect('/partners')

  return (
    <div className="min-h-[80vh] overflow-hidden rounded-lg bg-gradient-to-br from-green-900 via-green-800 to-emerald-900">
      {/* Same nav as real partner page, with Demo label and back link */}
      <nav className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/partners"
              className="text-white/70 hover:text-white"
              title="Back to Partner Management"
            >
              ← Back
            </Link>
            <Link
              href="/admin/partners/demo"
              className="flex items-center gap-2"
            >
              <span className="text-2xl">🦶</span>
              <span className="text-lg font-bold text-white">
                Sasquatch Partner Portal
              </span>
              <span className="rounded bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-amber-950">
                Demo
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-white/70 sm:block">
              {DEMO_PARTNER.company_name}
            </span>
            <ThemeSwitcher />
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-4 py-8">
        <PartnerDashboard
          partner={DEMO_PARTNER}
          referrals={DEMO_REFERRALS}
          incomingWork={DEMO_INCOMING_WORK}
          stats={{
            creditBalance: DEMO_PARTNER.credit_balance,
            totalReferrals: DEMO_REFERRALS.length,
            convertedReferrals: DEMO_REFERRALS.filter(
              (r) => r.status === 'converted',
            ).length,
            pendingReferrals: DEMO_REFERRALS.filter(
              (r) => r.status === 'pending',
            ).length,
            bookedReferrals: DEMO_REFERRALS.filter((r) => r.status === 'booked')
              .length,
          }}
          demo
        />
      </div>
    </div>
  )
}
