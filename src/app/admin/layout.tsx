import { redirect } from 'next/navigation'
import { EnvVarWarning } from '@/components/env-var-warning'
import { AuthButton } from '@/components/auth-button'
import { hasEnvVars } from '@/utils/env'
import { getUserWithRole } from '@/lib/auth'
import Link from 'next/link'
import { Suspense } from 'react'
import { AdminNavigation } from '@/components/admin-navigation'
import { OneSignalInit } from '@/components/onesignal-init'
import { PushNotificationBanner } from '@/components/push-notification-banner'
import { VideoBackground } from '@/components/public/VideoBackground'
import { SoftphoneProvider } from '@/components/admin/softphone'
import { MobileHeader } from '@/components/admin/mobile-header'
import { MobileBottomNav } from '@/components/admin/mobile-bottom-nav'
import { GpsTrackerProvider } from '@/contexts/GpsTrackerContext'

type AdminLayoutProps = {
  children: React.ReactNode
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Check authentication and role
  const { user, role, partner } = await getUserWithRole()

  console.log('[AdminLayout] User:', user?.email)
  console.log('[AdminLayout] Role:', role)
  console.log('[AdminLayout] Partner record:', partner?.name)

  // Must be authenticated
  if (!user) {
    console.log('[AdminLayout] No user, redirecting to login')
    redirect('/auth/login')
  }

  // Tech users go to the tech portal
  if (role === 'tech') {
    redirect('/tech')
  }

  // Partners do not belong here
  if (role === 'partner') {
    redirect('/partners')
  }

  console.log('[AdminLayout] Access granted - internal ops role:', role)

  // GPS enabled for owner, tech, and legacy admin (anyone who does field work)
  const gpsEnabled = ['owner', 'tech', 'admin'].includes(role ?? '')

  return (
    <SoftphoneProvider>
      <GpsTrackerProvider gpsEnabled={gpsEnabled}>
        <main className="text-foreground relative min-h-screen">
          <VideoBackground video="clouds" />
          <div className="pointer-events-none fixed inset-0 z-0 bg-slate-950/55" />
          <OneSignalInit />

          {/* Mobile-only top header with hamburger drawer */}
          <MobileHeader userEmail={user.email ?? ''} />

          <div className="relative z-10 flex w-full flex-1 flex-col items-center gap-8 pt-14 pb-10 sm:pt-0 sm:pb-10">
            {/* Desktop-only top nav bar */}
            <nav className="glass-nav hidden h-14 w-full justify-center border-b sm:flex">
              <div className="flex w-full max-w-[1440px] items-center justify-between px-4 text-sm">
                <Link
                  href={'/admin'}
                  className="text-foreground flex items-center gap-2 font-semibold drop-shadow-[0_0_14px_rgba(16,185,129,0.35)]"
                >
                  <img
                    src="/vector6-no-background.svg"
                    alt="Sasquatch"
                    className="h-8 w-auto"
                  />
                  <span className="hidden sm:inline">Admin</span>
                </Link>
                {!hasEnvVars ? (
                  <EnvVarWarning />
                ) : (
                  <Suspense>
                    <AuthButton />
                  </Suspense>
                )}
              </div>
            </nav>

            <div
              className={`flex w-full flex-1 flex-col gap-6 p-4 sm:p-5 ${gpsEnabled ? 'pb-24 sm:pb-20' : 'pb-24 sm:pb-10'}`}
            >
              <PushNotificationBanner />
              {/* Desktop-only nav panel */}
              <div className="glass-panel glass-accent-ring relative z-[200] hidden rounded-2xl border p-4 sm:block">
                <AdminNavigation />
              </div>
              <div className="glass-panel glass-accent-ring animate-slide-up relative z-[10] rounded-2xl border p-4 sm:p-6">
                {children}
              </div>
            </div>

            <footer className="glass-nav text-muted-foreground mx-auto hidden w-full items-center justify-center gap-8 border-t py-8 text-center text-xs sm:flex">
              <p>Sasquatch Carpet Cleaning</p>
            </footer>
          </div>

          {/* Mobile-only bottom tab bar */}
          <MobileBottomNav />
        </main>
      </GpsTrackerProvider>
    </SoftphoneProvider>
  )
}
