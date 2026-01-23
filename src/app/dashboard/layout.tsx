import { redirect } from 'next/navigation'
import { EnvVarWarning } from '@/components/env-var-warning'
import { AuthButton } from '@/components/auth-button'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { hasEnvVars } from '@/utils/env'
import { getUserWithRole } from '@/lib/auth'
import Link from 'next/link'
import { Suspense } from 'react'
import { DashboardNavigation } from '@/components/dashboard-navigation'

type DashboardLayoutProps = {
  children: React.ReactNode
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  // Check authentication and role
  const { user, role } = await getUserWithRole()

  // Must be authenticated
  if (!user) {
    redirect('/auth/login')
  }

  // Only admins can access dashboard
  if (role !== 'admin') {
    redirect('/partners')
  }

  return (
    <main className="flex min-h-screen flex-col">
      {/* Compact mobile header */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/dashboard/leads" className="flex items-center gap-2">
            <img src="/logo.svg" alt="Sasquatch" className="h-7 w-auto" />
            <span className="font-semibold text-sm">Dashboard</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link 
              href="/admin" 
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Admin →
            </Link>
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </div>
        </div>
        <DashboardNavigation />
      </nav>

      {/* Full-width content for mobile */}
      <div className="flex-1 p-4 md:p-6">
        {children}
      </div>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-4">
          <span>Sasquatch Carpet Cleaning</span>
          <ThemeSwitcher />
        </div>
      </footer>
    </main>
  )
}
