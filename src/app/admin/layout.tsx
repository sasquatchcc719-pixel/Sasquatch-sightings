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
    <main className="flex min-h-screen flex-col items-center">
      <OneSignalInit />
      <div className="flex w-full flex-1 flex-col items-center gap-20">
        <nav className="border-b-foreground/10 flex h-14 w-full justify-center border-b">
          <div className="flex w-full max-w-5xl items-center justify-between px-4 text-sm">
            <Link
              href={'/admin'}
              className="flex items-center gap-2 font-semibold"
            >
              <img
                src="/vector6-no-background.svg"
                alt="Sasquatch"
                className="h-7 w-auto"
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
        <div className="flex max-w-5xl flex-1 flex-col gap-8 p-5">
          <AdminNavigation />
          {children}
        </div>

        <footer className="mx-auto flex w-full items-center justify-center gap-8 border-t py-16 text-center text-xs">
          <p>Sasquatch Carpet Cleaning</p>
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  )
}
