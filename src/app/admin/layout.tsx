import { redirect } from 'next/navigation'
import { EnvVarWarning } from '@/components/env-var-warning'
import { AuthButton } from '@/components/auth-button'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { hasEnvVars } from '@/utils/env'
import { getUserWithRole } from '@/lib/auth'
import Link from 'next/link'
import { Suspense } from 'react'
import { AdminNavigation } from '@/components/admin-navigation'
import { OneSignalInit } from '@/components/onesignal-init'
import { VideoBackground } from '@/components/public/VideoBackground'

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

  // CRITICAL: Partners must NOT access admin routes
  // Only allow if role is explicitly 'admin' OR if there's no partner record (legacy admin)
  if (role !== 'admin') {
    console.log(
      '[AdminLayout] User is NOT admin (role:',
      role,
      '), redirecting to /partners',
    )
    redirect('/partners')
  }

  console.log('[AdminLayout] Access granted - user is admin')

  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden">
      {/* Video Background */}
      <VideoBackground video="psychedelic" />

      <OneSignalInit />
      <div className="relative z-10 flex w-full flex-1 flex-col items-center gap-20">
        <nav className="flex h-14 w-full justify-center border-b border-white/20 bg-black/10 backdrop-blur-sm">
          <div className="flex w-full max-w-5xl items-center justify-between px-4 text-sm">
            <Link
              href={'/admin'}
              className="flex items-center gap-2 font-semibold text-white drop-shadow-lg"
            >
              <img
                src="/vector6-no-background.svg"
                alt="Sasquatch"
                className="h-8 w-auto drop-shadow-lg"
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
        <div className="flex w-full max-w-5xl flex-1 flex-col gap-8 p-5">
          <div className="relative z-[200] rounded-2xl border border-white/20 bg-black/20 p-6 shadow-2xl backdrop-blur-sm">
            <AdminNavigation />
          </div>
          <div className="relative z-[10] rounded-2xl border border-white/20 bg-black/20 p-6 shadow-2xl backdrop-blur-sm">
            {children}
          </div>
        </div>

        <footer className="relative z-10 mx-auto flex w-full items-center justify-center gap-8 border-t border-white/20 bg-black/10 py-16 text-center text-xs text-white/80 backdrop-blur-sm">
          <p>Sasquatch Carpet Cleaning</p>
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  )
}
