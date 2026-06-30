import { redirect } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'
import { LogoutButton } from '@/components/logout-button'

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, role, client } = await getUserWithRole()

  if (!user) {
    redirect('/auth/login')
  }

  // Only client managers belong here. Send everyone else to their own portal.
  if (role !== 'client_manager' || !client) {
    redirect('/redirect')
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950">
      <nav className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🦶</span>
            <div className="leading-tight">
              <span className="block text-base font-bold text-white">
                Sasquatch · Client Portal
              </span>
              <span className="block text-xs text-white/60">
                {client.display_name}
              </span>
            </div>
          </div>
          <LogoutButton />
        </div>
      </nav>
      <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
    </main>
  )
}
