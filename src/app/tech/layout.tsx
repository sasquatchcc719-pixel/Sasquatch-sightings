import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { getUserWithRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { AuthButton } from '@/components/auth-button'
import { TechClockControl } from '@/components/tech/tech-clock-control'
import { SquarePaymentPushSetup } from '@/components/tech/square-payment-push-setup'

const techNavItems = [
  { href: '/tech', label: 'Jobs' },
  { href: '/tech/receipts', label: 'Receipts' },
  { href: '/tech/profile', label: 'Profile' },
  { href: '/field/canvass', label: '🚶 Canvassing' },
  { href: '/field/foreman', label: '🧠 Brain' },
  { href: '/field/inventory', label: '📦 Inventory' },
  { href: '/field/checkin', label: '⚙️ Gears' },
]

export default async function TechLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, role } = await getUserWithRole()

  if (!user) redirect('/auth/login')
  if (
    !role ||
    role === 'partner' ||
    role === 'marketing' ||
    role === 'dispatcher'
  ) {
    redirect('/admin')
  }

  const { count: maintenanceDueCount } = await createAdminClient()
    .from('maintenance_tasks')
    .select('id', { count: 'exact', head: true })
    .in('status', ['unassigned', 'scheduled'])

  const oneSignalAppId =
    process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || process.env.ONESIGNAL_APP_ID

  return (
    <main className="min-h-screen bg-slate-950 pb-32 text-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/tech"
              className="flex items-center gap-2 font-semibold"
            >
              <Image
                src="/vector6-no-background.svg"
                alt="Sasquatch"
                width={32}
                height={32}
              />
              <span>Tech Portal</span>
            </Link>
            <AuthButton />
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {techNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="relative shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-slate-200 transition hover:border-emerald-400/40 hover:bg-emerald-400/10 hover:text-emerald-100"
              >
                {item.label}
                {item.href === '/field/checkin' && maintenanceDueCount ? (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-black">
                    {maintenanceDueCount}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
        </header>
        <div className="flex-1 px-4 py-5">
          {role === 'tech' && oneSignalAppId ? (
            <SquarePaymentPushSetup
              appId={oneSignalAppId}
              externalId={user.id}
            />
          ) : null}
          {children}
        </div>
      </div>
      <TechClockControl />
    </main>
  )
}
