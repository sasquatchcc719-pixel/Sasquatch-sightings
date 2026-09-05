import { redirect } from 'next/navigation'
import { getUserWithRole } from '@/lib/auth'
import { LogoutButton } from '@/components/logout-button'
import Image from 'next/image'

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
    <main className="min-h-screen bg-[#112c29]">
      <nav className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-2">
            <Image
              src="/proudsquatch.png"
              className="mix-blend-screen"
              width={26}
              height={32}
              alt=""
            />
            <div className="leading-tight">
              <span className="block text-base font-bold text-white">
                Sasquatch
              </span>
              <span className="block text-xs text-white/60">
                COMMERCIAL CLIENT PORTAL
              </span>
            </div>
          </div>
          <LogoutButton />
        </div>
      </nav>
      <div className="mx-auto max-w-7xl px-3 py-6 sm:px-8 sm:py-8">
        {children}
      </div>
    </main>
  )
}
