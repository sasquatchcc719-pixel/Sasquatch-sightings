import { redirect } from 'next/navigation'
import { EnvVarWarning } from '@/components/env-var-warning'
import { AuthButton } from '@/components/auth-button'
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
  // Allow internal staff roles here; individual pages/APIs can still enforce stricter access.
  if (role === 'partner' || !role) {
    console.log(
      '[AdminLayout] User is not an internal ops role (role:',
      role,
      '), redirecting to /partners',
    )
    redirect('/partners')
  }

  console.log('[AdminLayout] Access granted - internal ops role:', role)

  return (
    <main className="text-foreground relative min-h-screen">
      <VideoBackground video="clouds" />
      <div className="pointer-events-none fixed inset-0 z-0 bg-slate-950/55" />
      <OneSignalInit />
      <div className="relative z-10 flex w-full flex-1 flex-col items-center gap-8 pb-10">
        <nav className="glass-nav flex h-14 w-full justify-center border-b">
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
        <div className="flex w-full max-w-[1440px] flex-1 flex-col gap-6 p-4 sm:p-5">
          <div className="glass-panel glass-accent-ring relative z-[200] rounded-2xl border p-4">
            <AdminNavigation />
          </div>
          <div className="glass-panel glass-accent-ring relative z-[10] rounded-2xl border p-4 sm:p-6">
            {children}
          </div>
        </div>

        <footer className="glass-nav text-muted-foreground mx-auto flex w-full items-center justify-center gap-8 border-t py-8 text-center text-xs">
          <p>Sasquatch Carpet Cleaning</p>
        </footer>
      </div>
    </main>
  )
}
