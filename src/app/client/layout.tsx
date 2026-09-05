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
          <div className="rounded-lg bg-white px-2 py-1">
            <Image
              src="/sasquatch-website-logo.png"
              className="h-auto w-36"
              width={2723}
              height={1155}
              sizes="144px"
              alt="Sasquatch Carpet Cleaning"
            />
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
